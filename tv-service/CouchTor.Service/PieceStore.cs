using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using MonoTorrent;
using MonoTorrent.Client;
using MonoTorrent.PieceWriter;
using ReusableTasks;

namespace CouchTor
{
    /// <summary>
    /// MonoTorrent's storage on the TV: one file per piece under <c>cache/&lt;hash&gt;/</c> instead of the full-size
    /// files, so the cache can stay far below a movie's size. A piece is complete once it passed its hash check
    /// and all its blocks are on disk; completions are appended to <c>cache/&lt;hash&gt;/done</c> (<c>+N</c>,
    /// <c>-N</c> when evicted) so they survive a restart. Before every write, least recently used complete pieces
    /// outside the open streams' windows are deleted (<see cref="PieceCache"/>) and the engine is told to download
    /// them again.
    /// </summary>
    sealed class PieceStore : IPieceWriter
    {
        const int Block = 16 * 1024;
        readonly string dir, filesDir;
        readonly PieceCache cache;
        readonly LogRing log;
        readonly ConcurrentDictionary<string, TorrentManager> managers = new ConcurrentDictionary<string, TorrentManager>();
        readonly Func<long> freeSpace;
        long evictedTotal;

        /// <summary>Pieces being downloaded: which blocks are on disk, and whether the hash passed.</summary>
        sealed class Pending { public bool[] Blocks; public int Written; public bool HashPassed; }
        readonly Dictionary<(string, int), Pending> pending = new Dictionary<(string, int), Pending>();

        /// <summary>Pieces deleted by eviction, per torrent: the engine must mark them missing.</summary>
        public Action<string, IReadOnlyList<int>> Evicted;

        public PieceStore(string cacheDir, string filesDir, PieceCache cache, Func<long> freeSpace, LogRing log)
        {
            dir = cacheDir;
            this.filesDir = filesDir.TrimEnd('/');
            this.cache = cache;
            this.freeSpace = freeSpace;
            this.log = log;
            Directory.CreateDirectory(dir);
        }

        public long EvictedTotal => System.Threading.Interlocked.Read(ref evictedTotal);

        string DonePath(string hash) => Path.Combine(dir, hash, "done");
        string PiecePath(string hash, int piece) => Path.Combine(dir, hash, piece.ToString());

        /// <summary>Indexes the complete pieces left by earlier runs and deletes the rest; compacts the done logs.</summary>
        public void Load()
        {
            int complete = 0, deleted = 0;
            foreach (var tdir in Directory.GetDirectories(dir))
            {
                var hash = Path.GetFileName(tdir);
                var done = new HashSet<int>();
                try
                {
                    if (File.Exists(DonePath(hash)))
                        foreach (var line in File.ReadAllLines(DonePath(hash)))
                            if (line.Length > 1 && int.TryParse(line.Substring(1), out int n))
                            {
                                if (line[0] == '+') done.Add(n); else done.Remove(n);
                            }
                }
                catch (Exception e) { log.Add("cache: " + hash + " done log: " + e.Message); }
                var kept = new List<int>();
                foreach (var f in Directory.GetFiles(tdir))
                {
                    var name = Path.GetFileName(f);
                    if (name == "done")
                        continue;
                    if (int.TryParse(name, out int piece) && done.Contains(piece))
                    {
                        cache.AddExisting(hash, piece, new FileInfo(f).Length);
                        kept.Add(piece);
                        complete++;
                    }
                    else
                    {
                        TryDelete(f);
                        deleted++;
                    }
                }
                try { File.WriteAllLines(DonePath(hash), kept.Select(k => "+" + k)); } catch { }
            }
            log.Add("cache: " + complete + " pieces, " + (cache.UsedBytes >> 20) + " MB (deleted " + deleted + " incomplete), cap " + (cache.Capacity >> 20) + " MB");
        }

        public void Attach(string hash, TorrentManager manager) => managers[hash] = manager;
        public void Detach(string hash) => managers.TryRemove(hash, out _);

        string HashOf(ITorrentManagerFile file)
        {
            var p = file.FullPath;
            if (!p.StartsWith(filesDir + "/", StringComparison.Ordinal))
                throw new IOException("file outside the files dir: " + p);
            var rest = p.Substring(filesDir.Length + 1);
            int slash = rest.IndexOf('/');
            return slash < 0 ? rest : rest.Substring(0, slash);
        }

        TorrentManager Manager(string hash)
        {
            if (managers.TryGetValue(hash, out var m) && m.Torrent != null)
                return m;
            throw new IOException("no metadata for " + hash);
        }

        /// <summary>The size of a complete piece (the last one is shorter).</summary>
        static long PieceBytes(TorrentManager m, int piece)
            => Math.Min(m.Torrent.PieceLength, m.Torrent.Size - (long)piece * m.Torrent.PieceLength);

        public IEnumerable<int> CachedPieces(TorrentManager manager)
        {
            var hash = manager.InfoHashes.V1OrV2.ToHex().ToLowerInvariant();
            var ok = new List<int>();
            foreach (var piece in cache.CompletePieces(hash))
            {
                var path = PiecePath(hash, piece);
                if (piece < manager.Torrent.PieceCount && File.Exists(path) && new FileInfo(path).Length == PieceBytes(manager, piece))
                    ok.Add(piece);
                else
                {
                    cache.Remove(hash, piece);
                    TryDelete(path);
                    AppendDone(hash, "-" + piece);
                }
            }
            if (ok.Count > 0)
                log.Add(hash.Substring(0, 8) + " restored " + ok.Count + " cached pieces");
            return ok;
        }

        void AppendDone(string hash, string line)
        {
            try
            {
                lock (pending)
                    File.AppendAllText(DonePath(hash), line + "\n");
            }
            catch (Exception e) { log.Add("cache: done log " + e.Message); }
        }

        /// <summary>Called for every hash result of a downloaded piece.</summary>
        public void OnPieceHashed(string hash, int piece, bool passed)
        {
            bool complete = false;
            lock (pending)
            {
                // Only results for pieces written this session matter. When a torrent starts, MonoTorrent reports
                // every piece as failed (no files to hash) and then the restored ones as passed: neither is a
                // download, and acting on the failures deleted cached pieces.
                if (!pending.TryGetValue((hash, piece), out var p))
                {
                    if (!passed || cache.IsComplete(hash, piece))
                        return;
                    pending[(hash, piece)] = p = NewPending(hash, piece);
                }
                if (passed)
                {
                    p.HashPassed = true;
                    complete = p.Written == p.Blocks.Length;
                    if (complete)
                        pending.Remove((hash, piece));
                }
                else
                    pending.Remove((hash, piece));
            }
            if (!passed)
            {
                cache.Remove(hash, piece);
                TryDelete(PiecePath(hash, piece));
            }
            else if (complete)
                Completed(hash, piece);
        }

        Pending NewPending(string hash, int piece)
        {
            var bytes = PieceBytes(Manager(hash), piece);
            return new Pending { Blocks = new bool[(bytes + Block - 1) / Block] };
        }

        void Completed(string hash, int piece)
        {
            cache.OnComplete(hash, piece, PieceBytes(Manager(hash), piece));
            AppendDone(hash, "+" + piece);
        }

        /// <summary>Deletes the partial pieces of a stopped torrent (the engine forgets partial progress).</summary>
        public void DropIncomplete(string hash)
        {
            lock (pending)
                foreach (var key in pending.Keys.Where(k => k.Item1 == hash).ToList())
                    pending.Remove(key);
            foreach (var piece in cache.RemoveIncomplete(hash))
                TryDelete(PiecePath(hash, piece));
        }

        public void RemoveTorrent(string hash)
        {
            DropIncomplete(hash);
            cache.RemoveTorrent(hash);
            try
            {
                var d = Path.Combine(dir, hash);
                if (Directory.Exists(d))
                    Directory.Delete(d, true);
            }
            catch (Exception e) { log.Add("cache: remove " + hash + " " + e.Message); }
        }

        static void TryDelete(string path)
        {
            try { File.Delete(path); } catch { }
        }

        void MakeRoom(long bytes)
        {
            var evicted = cache.Evict(bytes);
            if (evicted.Count > 0)
            {
                foreach (var kv in evicted)
                {
                    TryDelete(PiecePath(kv.Key, kv.Value));
                    AppendDone(kv.Key, "-" + kv.Value);
                }
                System.Threading.Interlocked.Add(ref evictedTotal, evicted.Count);
                foreach (var g in evicted.GroupBy(kv => kv.Key))
                    Evicted?.Invoke(g.Key, g.Select(kv => kv.Value).ToList());
            }
            if (freeSpace() - bytes < PieceCache.FreeFloorBytes)
                throw new IOException("cache: keeping " + (PieceCache.FreeFloorBytes >> 20) + " MB of the disk free, nothing left to evict");
        }

        void Write(ITorrentManagerFile file, long offset, ReadOnlyMemory<byte> buffer)
        {
            var hash = HashOf(file);
            var m = Manager(hash);
            int pl = m.Torrent.PieceLength;
            long abs = file.OffsetInTorrent + offset;
            while (buffer.Length > 0)
            {
                int piece = (int)(abs / pl);
                int inPiece = (int)(abs % pl);
                int n = Math.Min(buffer.Length, pl - inPiece);
                MakeRoom(n);
                Directory.CreateDirectory(Path.Combine(dir, hash));
                using (var fs = new FileStream(PiecePath(hash, piece), FileMode.OpenOrCreate, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete, 1, FileOptions.None))
                {
                    fs.Seek(inPiece, SeekOrigin.Begin);
                    fs.Write(buffer.Span.Slice(0, n));
                }
                cache.OnWrite(hash, piece, inPiece + n);
                bool complete = false;
                lock (pending)
                {
                    if (!pending.TryGetValue((hash, piece), out var p))
                        pending[(hash, piece)] = p = NewPending(hash, piece);
                    for (int b = inPiece / Block; b <= (inPiece + n - 1) / Block && b < p.Blocks.Length; b++)
                        if (!p.Blocks[b])
                        {
                            p.Blocks[b] = true;
                            p.Written++;
                        }
                    if (p.HashPassed && p.Written == p.Blocks.Length)
                    {
                        pending.Remove((hash, piece));
                        complete = true;
                    }
                }
                if (complete)
                    Completed(hash, piece);
                buffer = buffer.Slice(n);
                abs += n;
            }
        }

        int Read(ITorrentManagerFile file, long offset, Memory<byte> buffer)
        {
            var hash = HashOf(file);
            int pl = Manager(hash).Torrent.PieceLength;
            long abs = file.OffsetInTorrent + offset;
            int done = 0;
            while (done < buffer.Length)
            {
                int piece = (int)(abs / pl);
                int inPiece = (int)(abs % pl);
                int n = Math.Min(buffer.Length - done, pl - inPiece);
                // MonoTorrent can report a piece downloaded while some of its blocks are still queued for writing;
                // an unwritten block inside the file reads as zeros. Until the piece is complete here, only read
                // ranges whose blocks are all on disk (a short read makes the caller retry).
                if (!cache.IsComplete(hash, piece) && !BlocksWritten(hash, piece, inPiece, n))
                    return done;
                if (ReadPiece(hash, piece, inPiece, buffer.Slice(done, n)) < n)
                    return done;
                cache.OnRead(hash, piece);
                done += n;
                abs += n;
            }
            return done;
        }

        bool BlocksWritten(string hash, int piece, int inPiece, int count)
        {
            lock (pending)
            {
                if (!pending.TryGetValue((hash, piece), out var p))
                    return false;
                for (int b = inPiece / Block; b <= (inPiece + count - 1) / Block; b++)
                    if (b >= p.Blocks.Length || !p.Blocks[b])
                        return false;
                return true;
            }
        }

        int ReadPiece(string hash, int piece, int inPiece, Memory<byte> dest)
        {
            try
            {
                using (var fs = new FileStream(PiecePath(hash, piece), FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1, FileOptions.None))
                {
                    if (fs.Length < inPiece + dest.Length)
                        return 0;
                    fs.Seek(inPiece, SeekOrigin.Begin);
                    int total = 0;
                    while (total < dest.Length)
                    {
                        int r = fs.Read(dest.Span.Slice(total));
                        if (r <= 0)
                            break;
                        total += r;
                    }
                    return total;
                }
            }
            catch (FileNotFoundException) { return 0; }
            catch (DirectoryNotFoundException) { return 0; }
        }

        /// <summary>The state of one piece, for error messages.</summary>
        public string Describe(string hash, int piece)
        {
            var path = PiecePath(hash, piece);
            string p;
            lock (pending)
                p = pending.TryGetValue((hash, piece), out var x) ? "pending " + x.Written + "/" + x.Blocks.Length + (x.HashPassed ? " hash ok" : "") : "not pending";
            return "file " + (File.Exists(path) ? new FileInfo(path).Length + " bytes" : "missing") + ", " + (cache.IsComplete(hash, piece) ? "complete" : "not complete") + ", " + p;
        }

        // IPieceWriter. MonoTorrent calls these on its disk loop: do the IO on the thread pool.
        public int OpenFiles => 0;
        public int MaximumOpenFiles => 0;

        public async ReusableTask WriteAsync(ITorrentManagerFile file, long offset, ReadOnlyMemory<byte> buffer)
            => await Task.Run(() => Write(file, offset, buffer)).ConfigureAwait(false);

        public async ReusableTask<int> ReadAsync(ITorrentManagerFile file, long offset, Memory<byte> buffer)
            => await Task.Run(() => Read(file, offset, buffer)).ConfigureAwait(false);

        public ReusableTask<bool> ExistsAsync(ITorrentManagerFile file) => ReusableTask.FromResult(false);
        public ReusableTask CloseAsync(ITorrentManagerFile file) => ReusableTask.CompletedTask;
        public ReusableTask FlushAsync(ITorrentManagerFile file) => ReusableTask.CompletedTask;
        public ReusableTask MoveAsync(ITorrentManagerFile file, string fullPath, bool overwrite) => ReusableTask.CompletedTask;
        public ReusableTask SetMaximumOpenFilesAsync(int maximumOpenFiles) => ReusableTask.CompletedTask;
        public void Dispose() { }
    }
}
