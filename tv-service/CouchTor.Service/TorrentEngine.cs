using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using MonoTorrent;
using MonoTorrent.Client;
using MonoTorrent.PiecePicking;

namespace CouchTor
{
    /// <summary><see cref="ITorrentBackend"/> on MonoTorrent.</summary>
    sealed class TorrentEngine : ITorrentBackend
    {
        public static readonly string[] Trackers = {
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://open.demonii.com:1337/announce",
            "udp://open.stealth.si:80/announce",
            "udp://tracker.torrent.eu.org:451/announce",
            "udp://exodus.desync.com:6969/announce",
            "udp://explodie.org:6969/announce",
            "udp://tracker.openbittorrent.com:6969/announce",
            "udp://opentracker.io:6969/announce",
            "udp://tracker.dler.org:6969/announce",
            "http://tracker.opentrackr.org:1337/announce",
        };

        public static readonly TimeSpan IdleStop = TimeSpan.FromMinutes(2);
        public static readonly TimeSpan MetadataTimeout = TimeSpan.FromSeconds(120);
        public const int UploadLimit = 64 * 1024;
        public const long ReadAhead = 64L << 20;
        /// <summary>Data just behind the read position is kept too (small rewinds, players re-reading headers).</summary>
        public const long ProtectBehind = 16L << 20;

        readonly string root, engineDir, filesDir, cacheDir;
        readonly PieceCache cache;
        readonly PieceStore store;
        int nextStreamId;
        readonly LogRing log;
        readonly ClientEngine engine;
        readonly Dictionary<string, Entry> torrents = new Dictionary<string, Entry>();
        readonly Stopwatch uptime = Stopwatch.StartNew();

        sealed class Entry
        {
            public string Hash;
            public Task<TorrentManager> Ready;
            public TorrentManager Manager;
            public int OpenStreams;
            public DateTime LastActive = DateTime.UtcNow;
            public string Error = "";
            public long AddedAt = Stopwatch.GetTimestamp();
            public ITorrentManagerFile LastFile;
            public long LastPosition;
            public bool Removed;
            public readonly TaskCompletionSource<TorrentManager> Added = new TaskCompletionSource<TorrentManager>(TaskCreationOptions.RunContinuationsAsynchronously);                       // set by RemoveAsync; an add still in progress cleans up after itself
            public readonly HashSet<string> Trackers = new HashSet<string>(); // every tracker the torrent has
        }

        public TorrentEngine(string dataDir, LogRing log)
        {
            this.log = log;
            root = dataDir;
            engineDir = Path.Combine(root, "engine");
            filesDir = Path.Combine(root, "files");
            cacheDir = Path.Combine(root, "cache");
            Directory.CreateDirectory(engineDir);
            // MonoTorrent's own save path: only empty placeholders end up here (the data is in cache/).
            try { if (Directory.Exists(filesDir)) Directory.Delete(filesDir, true); } catch (Exception e) { log.Add("files: " + e.Message); }
            Directory.CreateDirectory(filesDir);
            cache = new PieceCache(FreeBytes);
            store = new PieceStore(cacheDir, filesDir, cache, FreeBytes, log);
            store.Load();
            store.Evicted = OnEvicted;
            CouchExtensions.CachedPieces = m => store.CachedPieces(m);
            LoopMonitor.Exception = e => log.Add("engine loop exception: " + e.GetType().Name + ": " + e.Message + " @ " + FirstFrame(e));

            var settings = new EngineSettingsBuilder
            {
                CacheDirectory = engineDir,
                AllowPortForwarding = false,
                AllowLocalPeerDiscovery = false,
                AutoSaveLoadDhtCache = true,
                AutoSaveLoadFastResume = false,
                AutoSaveLoadMagnetLinkMetadata = true,
                MaximumUploadRate = UploadLimit,
                MaximumConnections = 100,
                MaximumHalfOpenConnections = 40,
                ConnectionTimeout = TimeSpan.FromSeconds(5),
                DhtEndPoint = new IPEndPoint(IPAddress.Any, 6881),
                ListenEndPoints = new Dictionary<string, IPEndPoint> { { "ipv4", new IPEndPoint(IPAddress.Any, 6881) } },
            }.ToSettings();
            StreamingPieceRequester.ReadAheadBytes = ReadAhead;
            engine = new ClientEngine(settings, Factories.Default.WithPieceWriterCreator(_ => store));
        }

        static string FirstFrame(Exception e)
        {
            var st = e.StackTrace ?? "";
            int nl = st.IndexOf('\n');
            return (nl < 0 ? st : st.Substring(0, nl)).Trim();
        }

        public async Task StartAsync()
        {
            try
            {
                var dht = engine.DhtNodeCachePath();
                log.Add("dht cache " + (File.Exists(dht) ? new FileInfo(dht).Length / 26 + " nodes" : "missing"));
                engine.Dht.StateChanged += (s, e) =>
                {
                    log.Add("dht " + engine.Dht.State + ", " + engine.Dht.NodeCount + " nodes");
                    if (engine.Dht.State == MonoTorrent.Dht.DhtState.Ready)
                        foreach (var m in Running())
                            _ = m.DhtLookupNowAsync();
                };
                await engine.StartAndKeepRunningAsync().ConfigureAwait(false);
                log.Add("engine started, dht " + engine.Dht.State);
            }
            catch (Exception e) { log.Add("engine start failed: " + e); }
            _ = Task.Run(HousekeepingLoop);
            _ = Task.Run(WatchdogLoop);
        }

        public async Task ShutdownAsync()
        {
            try { if (engine.Dht.NodeCount >= 16) log.Add("saved " + await engine.SaveDhtNodesNowAsync().ConfigureAwait(false) + " dht nodes"); }
            catch (Exception e) { log.Add("dht save failed: " + e.Message); }
        }

        Entry GetOrAdd(string hash, IReadOnlyList<string> trackers)
        {
            lock (torrents)
            {
                if (torrents.TryGetValue(hash, out var existing) && !(existing.Ready.IsFaulted || existing.Ready.IsCanceled))
                {
                    var fresh = (trackers ?? new string[0]).Where(t => !existing.Trackers.Contains(t)).ToList();
                    if (fresh.Count > 0)
                        _ = AddTrackersAsync(existing, fresh);
                    return existing;
                }
                var entry = new Entry { Hash = hash };
                entry.Ready = AddAsync(entry, trackers);
                torrents[hash] = entry;
                return entry;
            }
        }

        /// <summary>Trackers from a later request for a torrent that's already added (each its own tier, announced now).</summary>
        async Task AddTrackersAsync(Entry entry, List<string> fresh)
        {
            lock (entry)
                fresh = fresh.Where(t => entry.Trackers.Add(t)).ToList();
            try
            {
                var manager = await entry.Added.Task.ConfigureAwait(false);
                foreach (var t in fresh)
                {
                    if (!Uri.TryCreate(t, UriKind.Absolute, out var uri))
                        continue;
                    await manager.TrackerManager.AddTrackerAsync(uri);
                    var tracker = manager.TrackerManager.Tiers.SelectMany(tier => tier.Trackers).FirstOrDefault(x => x.Uri == uri);
                    if (tracker != null && manager.State != TorrentState.Stopped)
                        _ = manager.TrackerManager.AnnounceAsync(tracker, CancellationToken.None).AsTask();
                }
                log.Add(entry.Hash.Substring(0, 8) + " added " + fresh.Count + " trackers");
            }
            catch (Exception e) { log.Add(entry.Hash.Substring(0, 8) + " add trackers: " + e.Message); }
        }

        async Task<TorrentManager> AddAsync(Entry entry, IReadOnlyList<string> extraTrackers)
        {
            try
            {
                var magnet = "magnet:?xt=urn:btih:" + entry.Hash;
                foreach (var t in (extraTrackers ?? new string[0]).Concat(Trackers).Distinct())
                {
                    magnet += "&tr=" + Uri.EscapeDataString(t);
                    lock (entry)
                        entry.Trackers.Add(t);
                }
                var manager = await engine.AddStreamingAsync(MagnetLink.Parse(magnet), Path.Combine(filesDir, entry.Hash)).ConfigureAwait(false);
                lock (entry)
                {
                    if (!entry.Removed)
                        entry.Manager = manager;
                }
                if (entry.Removed)
                {
                    // /remove came while the torrent was being added: don't leave an untracked torrent running.
                    await engine.RemoveAsync(manager, RemoveMode.CacheDataAndDownloadedData).ConfigureAwait(false);
                    throw new OperationCanceledException("removed while adding");
                }
                entry.Added.TrySetResult(manager);
                store.Attach(entry.Hash, manager);
                manager.PieceHashed += (s, e) => store.OnPieceHashed(entry.Hash, e.PieceIndex, e.HashPassed);
                await manager.StartAsync().ConfigureAwait(false);
                log.Add(entry.Hash + " added (" + (manager.HasMetadata ? "metadata cached" : "fetching metadata") + ", " + (extraTrackers?.Count ?? 0) + " extra trackers)");
                if (!manager.HasMetadata)
                {
                    await manager.WaitForMetadataAsync().ConfigureAwait(false);
                    log.Add(entry.Hash + " metadata after " + Elapsed(entry.AddedAt) + ": " + manager.Torrent.Name + ", " + manager.Files.Count + " files, piece " + manager.Torrent.PieceLength);
                }
                return manager;
            }
            catch (Exception e)
            {
                entry.Added.TrySetException(e);
                entry.Error = e.Message;
                log.Add(entry.Hash + " add failed: " + e.Message);
                throw;
            }
        }

        static string Elapsed(long since) => ((Stopwatch.GetTimestamp() - since) / (double)Stopwatch.Frequency).ToString("0.0") + " s";

        public async Task<IStreamFile> OpenAsync(string hash, int fileIdx, IReadOnlyList<string> trackers, CancellationToken token)
        {
            var entry = GetOrAdd(hash, trackers);
            Interlocked.Increment(ref entry.OpenStreams);
            entry.LastActive = DateTime.UtcNow;
            try
            {
                var waiting = entry.Manager;
                if (waiting != null && !waiting.HasMetadata && (waiting.State == TorrentState.Stopped || waiting.State == TorrentState.Error))
                {
                    // Stopped by the idle rule after an earlier metadata timeout: entry.Ready only completes once
                    // the metadata arrives, so the manager must run again.
                    log.Add(hash + " restarting to fetch metadata (was " + waiting.State + ")");
                    await waiting.StartAsync().ConfigureAwait(false);
                }
                var ready = entry.Ready;
                var done = await Task.WhenAny(ready, Task.Delay(MetadataTimeout, token)).ConfigureAwait(false);
                token.ThrowIfCancellationRequested();
                if (done != ready)
                    throw new ServiceException(504, "no metadata after " + MetadataTimeout.TotalSeconds + " s");
                var manager = await ready.ConfigureAwait(false);
                if (manager.State == TorrentState.Stopped || manager.State == TorrentState.Error)
                {
                    log.Add(hash + " restarting (was " + manager.State + ")");
                    await manager.StartAsync().ConfigureAwait(false);
                }
                var file = PickFile(manager, fileIdx);
                return new StreamFile(this, entry, manager, file);
            }
            catch
            {
                Interlocked.Decrement(ref entry.OpenStreams);
                throw;
            }
        }

        static ITorrentManagerFile PickFile(TorrentManager manager, int fileIdx)
        {
            var files = manager.Files;
            if (fileIdx >= files.Count)
                throw new ServiceException(404, "no file " + fileIdx + " (torrent has " + files.Count + ")");
            if (fileIdx >= 0)
                return files[fileIdx];
            var videos = files.Where(f => ContentTypes.IsVideo(f.Path)).ToList();
            return (videos.Count > 0 ? videos : files.ToList()).OrderByDescending(f => f.Length).First();
        }

        sealed class StreamFile : IStreamFile
        {
            readonly TorrentEngine owner;
            readonly Entry entry;
            readonly TorrentManager manager;
            readonly ITorrentManagerFile file;
            readonly IStreamingPieceRequester requester;
            long expected = -1;
            int disposed;
            readonly int id;
            readonly int behind, ahead;

            public StreamFile(TorrentEngine owner, Entry entry, TorrentManager manager, ITorrentManagerFile file)
            {
                this.owner = owner;
                this.entry = entry;
                this.manager = manager;
                this.file = file;
                requester = manager.StreamingRequester();
                entry.LastFile = file;
                id = Interlocked.Increment(ref owner.nextStreamId);
                int pl = manager.Torrent.PieceLength;
                behind = (int)Math.Max(2, ProtectBehind / pl);
                ahead = (int)Math.Max(8, (ReadAhead + ProtectBehind) / pl);
            }

            public string Name => file.Path;
            public long Length => file.Length;

            public async Task<int> ReadAsync(long position, byte[] buffer, int offset, int count, CancellationToken token)
            {
                if (position >= file.Length)
                    return 0;
                var torrent = manager.Torrent;
                long abs = file.OffsetInTorrent + position;
                int piece = torrent.ByteOffsetToPieceIndex(abs);
                long pieceEnd = (long)(piece + 1) * torrent.PieceLength - file.OffsetInTorrent;
                count = (int)Math.Min(count, Math.Min(pieceEnd, file.Length) - position);

                if (position != expected)
                    requester?.SeekToPosition(file, position);
                else
                    requester?.ReadToPosition(file, position);
                entry.LastActive = DateTime.UtcNow;
                entry.LastPosition = position;
                owner.cache.SetWindow(entry.Hash, id, piece - behind, piece + ahead);

                while (!manager.Bitfield[piece])
                {
                    if (manager.State == TorrentState.Stopped || manager.State == TorrentState.Error)
                        throw new IOException("torrent " + manager.State);
                    await Task.Delay(25, token).ConfigureAwait(false);
                }
                // MonoTorrent marks a piece downloaded once its hash passes, which can be before its last blocks
                // have left the engine's write queue: retry briefly.
                for (int attempt = 0; ; attempt++)
                {
                    if (await manager.ReadFileAsync(file, position, new Memory<byte>(buffer, offset, count)).ConfigureAwait(false))
                        break;
                    if (attempt == 50 || !manager.Bitfield[piece])
                        throw new IOException("read failed at " + position + " (piece " + piece + (manager.Bitfield[piece] ? "" : ", evicted") + ", " + owner.store.Describe(entry.Hash, piece) + ")");
                    await Task.Delay(100, token).ConfigureAwait(false);
                }
                expected = position + count;
                entry.LastActive = DateTime.UtcNow;
                return count;
            }

            public void Dispose()
            {
                if (Interlocked.Exchange(ref disposed, 1) == 0)
                {
                    owner.cache.ClearWindow(entry.Hash, id);
                    Interlocked.Decrement(ref entry.OpenStreams);
                    entry.LastActive = DateTime.UtcNow;
                }
            }
        }

        public TorrentStats Stats(string hash, int? fileIdx)
        {
            Entry entry;
            lock (torrents)
                if (!torrents.TryGetValue(hash, out entry))
                    return null;
            return StatsOf(entry, fileIdx);
        }

        TorrentStats StatsOf(Entry entry, int? fileIdx)
        {
            var s = new TorrentStats();
            var m = entry.Manager;
            if (entry.Ready.IsFaulted || m?.State == TorrentState.Error)
            {
                s.State = "error";
                s.Error = entry.Error.Length > 0 ? entry.Error : m?.Error?.Exception?.Message ?? "error";
            }
            else if (m == null || !m.HasMetadata)
                s.State = "metadata";
            else if (m.State == TorrentState.Stopped)
                s.State = "stopped";
            else
                s.State = "downloading";
            if (m == null)
                return s;
            s.Peers = m.OpenConnections;
            s.DownloadSpeed = m.Monitor.DownloadRate;
            s.UploadSpeed = m.Monitor.UploadRate;
            s.Downloaded = m.Monitor.DataBytesReceived;
            s.Uploaded = m.Monitor.DataBytesSent;
            if (m.HasMetadata)
            {
                s.Name = m.Torrent.Name;
                if (fileIdx.HasValue)
                {
                    try
                    {
                        var f = PickFile(m, fileIdx.Value);
                        s.StreamName = Path.GetFileName(f.Path);
                        s.StreamLen = f.Length;
                        s.StreamProgress = f.BitField.Length == 0 ? 0 : f.BitField.TrueCount / (double)f.BitField.Length;
                    }
                    catch (ServiceException) { }
                }
            }
            return s;
        }

        public IReadOnlyList<KeyValuePair<string, TorrentStats>> AllStats()
        {
            List<Entry> list;
            lock (torrents)
                list = torrents.Values.ToList();
            return list.Select(e => new KeyValuePair<string, TorrentStats>(e.Hash, StatsOf(e, null))).ToList();
        }

        public async Task RemoveAsync(string hash)
        {
            Entry entry;
            lock (torrents)
            {
                torrents.TryGetValue(hash, out entry);
                torrents.Remove(hash);
            }
            TorrentManager pendingAdd = null;
            if (entry != null)
                lock (entry)
                {
                    entry.Removed = true;
                    pendingAdd = entry.Manager;
                }
            try
            {
                var manager = pendingAdd;
                if (manager != null)
                {
                    await manager.StopAsync(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
                    await engine.RemoveAsync(manager, RemoveMode.CacheDataAndDownloadedData).ConfigureAwait(false);
                }
                store.Detach(hash);
                store.RemoveTorrent(hash);
                // Not loaded (e.g. after a restart): the cached metadata still has to go.
                foreach (var f in new[] { Path.Combine(engineDir, "metadata", hash.ToUpperInvariant() + ".torrent"), Path.Combine(engineDir, "fastresume", hash.ToUpperInvariant() + ".fresume") })
                    if (File.Exists(f))
                        File.Delete(f);
                var dir = Path.Combine(filesDir, hash);
                if (Directory.Exists(dir))
                    Directory.Delete(dir, true);
                log.Add(hash + " removed, free " + (FreeBytes() >> 20) + " MB");
            }
            catch (Exception e) { log.Add(hash + " remove: " + e.Message); }
        }

        List<TorrentManager> Running()
        {
            lock (torrents)
                return torrents.Values.Select(e => e.Manager).Where(m => m != null && m.State != TorrentState.Stopped).ToList();
        }

        long FreeBytes() { try { return new DriveInfo(root).AvailableFreeSpace; } catch { return -1; } }

        void OnEvicted(string hash, IReadOnlyList<int> pieces)
        {
            Entry entry;
            lock (torrents)
                torrents.TryGetValue(hash, out entry);
            var m = entry?.Manager;
            if (m != null)
                m.ForgetPiecesAsync(pieces).ContinueWith(t => log.Add("forget pieces: " + t.Exception.GetBaseException().Message), TaskContinuationOptions.OnlyOnFaulted);
        }

        static long DirBytes(string path)
        {
            long total = 0;
            try
            {
                foreach (var f in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
                    try { total += new FileInfo(f).Length; } catch { }
            }
            catch { }
            return total;
        }

        async Task HousekeepingLoop()
        {
            int tick = 0;
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
                tick++;
                try
                {
                    List<Entry> list;
                    lock (torrents)
                        list = torrents.Values.ToList();
                    foreach (var e in list)
                    {
                        var m = e.Manager;
                        if (m == null)
                            continue;
                        // Short of peers: ask the DHT again now rather than in MonoTorrent's 3 minutes.
                        if ((m.State == TorrentState.Metadata || m.State == TorrentState.Downloading) && (!m.HasMetadata || m.OpenConnections < 8))
                            _ = m.DhtLookupNowAsync();
                        if (tick % 3 == 0 && m.State != TorrentState.Stopped)
                            log.Add(e.Hash.Substring(0, 8) + " " + m.State + " peers " + m.OpenConnections + " down " + (m.Monitor.DownloadRate >> 10) + " KB/s up " + (m.Monitor.UploadRate >> 10)
                                + " KB/s got " + (m.Monitor.DataBytesReceived >> 20) + " MB pieces " + (m.HasMetadata ? m.Bitfield.TrueCount + "/" + m.Bitfield.Length : "-") + " streams " + e.OpenStreams
                                + " disk w" + (engine.DiskManager.PendingWriteBytes >> 10) + "K r" + (engine.DiskManager.PendingReadBytes >> 10) + "K");
                        if (e.OpenStreams == 0 && m.State != TorrentState.Stopped && m.State != TorrentState.Stopping && DateTime.UtcNow - e.LastActive > IdleStop)
                        {
                            log.Add(e.Hash + " idle for " + IdleStop.TotalMinutes + " min, stopping");
                            await m.StopAsync(TimeSpan.FromSeconds(10)).ConfigureAwait(false);
                            store.DropIncomplete(e.Hash);
                        }
                    }
                    // The routing table makes the next start fast; the TV can kill us anytime, so save it often
                    // (only a healthy one: a half-empty table would replace a good file).
                    if (tick % 6 == 0 && engine.Dht.NodeCount >= 16)
                        await engine.SaveDhtNodesNowAsync().ConfigureAwait(false);
                }
                catch (Exception ex) { log.Add("housekeeping: " + ex.Message); }
            }
        }

        async Task WatchdogLoop()
        {
            bool reported = false;
            while (true)
            {
                await Task.Delay(TimeSpan.FromSeconds(2)).ConfigureAwait(false);
                var busy = LoopMonitor.LongestBusyMs();
                if (busy > 5000 && !reported)
                {
                    reported = true;
                    log.Add("WATCHDOG engine loop stuck " + busy + " ms:\n" + LoopMonitor.Describe() + ProcThreads.Describe());
                }
                else if (busy < 1000)
                    reported = false;
            }
        }

        public string Debug(IReadOnlyList<KeyValuePair<string, string>> query)
        {
            var sb = new StringBuilder();
            foreach (var kv in query)
                if (kv.Key == "cacheCap" && long.TryParse(kv.Value, out long cap))
                {
                    cache.CapOverride = cap;
                    log.Add("cache cap override " + (cap >> 20) + " MB");
                }
            var proc = Process.GetCurrentProcess();
            sb.Append("uptime ").Append((long)uptime.Elapsed.TotalSeconds).Append(" s, cpu ").Append((long)proc.TotalProcessorTime.TotalSeconds)
              .Append(" s (").Append((proc.TotalProcessorTime.TotalSeconds * 100 / Math.Max(1, uptime.Elapsed.TotalSeconds)).ToString("0")).Append("% avg of one core)\n");
            sb.Append(LoopMonitor.Describe());
            ThreadPool.GetAvailableThreads(out int w, out int io);
            ThreadPool.GetMaxThreads(out int mw, out int mio);
            sb.Append("threadpool busy workers ").Append(mw - w).Append(" io ").Append(mio - io).Append('\n');
            var dm = engine.DiskManager;
            sb.Append("disk pendingWrite ").Append(dm.PendingWriteBytes).Append(" pendingRead ").Append(dm.PendingReadBytes)
              .Append(" writeRate ").Append(dm.WriteRate).Append(" written ").Append(dm.TotalBytesWritten).Append(" cache ").Append(dm.CacheBytesUsed).Append('\n');
            sb.Append("dht ").Append(engine.Dht.State).Append(" nodes ").Append(engine.Dht.NodeCount)
              .Append(" sent ").Append(engine.Dht.Monitor.BytesSent).Append(" received ").Append(engine.Dht.Monitor.BytesReceived).Append('\n');
            sb.Append("cache used ").Append(cache.UsedBytes).Append(" cap ").Append(cache.Capacity).Append(" evicted ").Append(store.EvictedTotal)
              .Append(" pieces; data dir ").Append(DirBytes(root)).Append(" bytes\n");
            sb.Append("free ").Append(FreeBytes() >> 20).Append(" MB, gc heap ").Append(GC.GetTotalMemory(false) >> 20).Append(" MB, ws ").Append(Process.GetCurrentProcess().WorkingSet64 >> 20).Append(" MB\n");
            List<Entry> list;
            lock (torrents)
                list = torrents.Values.ToList();
            foreach (var e in list)
            {
                var m = e.Manager;
                sb.Append(e.Hash).Append(' ').Append(m?.State.ToString() ?? "adding").Append(" streams ").Append(e.OpenStreams).Append(" pos ").Append(e.LastPosition);
                if (m != null)
                {
                    sb.Append(" peers ").Append(m.OpenConnections).Append(" down ").Append(m.Monitor.DownloadRate).Append(" got ").Append(m.Monitor.DataBytesReceived);
                    if (m.HasMetadata)
                    {
                        sb.Append(" have ").Append(m.Bitfield.TrueCount).Append('/').Append(m.Bitfield.Length).Append(" piece ").Append(m.Torrent.PieceLength);
                        if (e.LastFile != null)
                        {
                            int first = m.Torrent.ByteOffsetToPieceIndex(e.LastFile.OffsetInTorrent + e.LastPosition), i = first;
                            while (i < m.Bitfield.Length && m.Bitfield[i])
                                i++;
                            sb.Append(" ahead ").Append((long)(i - first) * m.Torrent.PieceLength >> 20).Append(" MB");
                        }
                    }
                    if (m.Error != null)
                        sb.Append(" error ").Append(m.Error.Reason).Append(' ').Append(m.Error.Exception?.Message);
                    sb.Append(" available ").Append(m.Peers.Available).Append('\n');
                    foreach (var tier in m.TrackerManager.Tiers)
                        foreach (var t in tier.Trackers)
                            sb.Append("  tracker ").Append(t.Uri).Append(' ').Append(t.Status).Append(" last ").Append((long)t.TimeSinceLastAnnounce.TotalSeconds).Append("s ")
                              .Append(t.FailureMessage).Append(t.WarningMessage).Append('\n');
                }
                sb.Append('\n');
            }
            if (withThreads)
                sb.Append(ProcThreads.Describe());
            return sb.ToString();
        }

        bool withThreads = true;
    }
}
