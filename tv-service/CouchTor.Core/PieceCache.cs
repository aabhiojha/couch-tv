using System;
using System.Collections.Generic;
using System.Linq;

namespace CouchTor
{
    /// <summary>
    /// Bookkeeping for the bounded piece cache: which pieces are stored and how big they are, when each was
    /// last used, and which ranges open streams are reading (protected from eviction). Thread-safe. The
    /// store does the file IO; this class only decides.
    /// </summary>
    public sealed class PieceCache
    {
        public const long MaxBytes = 1L << 30;           // 1 GiB
        public const long FreeFloorBytes = 400L << 20;   // keep 400 MiB of the disk free

        sealed class Item
        {
            public long Bytes;
            public long LastUse;
            public bool Complete;
        }

        sealed class Window { public int First, Last; }

        readonly object gate = new object();
        readonly Dictionary<string, Dictionary<int, Item>> torrents = new Dictionary<string, Dictionary<int, Item>>();
        readonly Dictionary<string, Dictionary<int, Window>> windows = new Dictionary<string, Dictionary<int, Window>>();
        long clock;
        long used;

        /// <summary>Returns the disk's free bytes (the cache's own files count as used).</summary>
        readonly Func<long> freeSpace;

        /// <summary>Overrides the computed capacity (tests and <c>/debug?cacheCap=</c>); 0 = automatic.</summary>
        public long CapOverride;

        public PieceCache(Func<long> freeSpace) { this.freeSpace = freeSpace; }

        public long UsedBytes { get { lock (gate) return used; } }

        /// <summary><c>min(1 GiB, free space - 400 MiB)</c>, where free space counts the cache as free.</summary>
        public long Capacity
        {
            get
            {
                if (CapOverride > 0)
                    return CapOverride;
                long free = freeSpace();
                return Math.Max(0, Math.Min(MaxBytes, free + UsedBytes - FreeFloorBytes));
            }
        }

        public static long CapacityFor(long freeBytes, long cacheBytes)
            => Math.Max(0, Math.Min(MaxBytes, freeBytes + cacheBytes - FreeFloorBytes));

        Dictionary<int, Item> Pieces(string torrent)
        {
            if (!torrents.TryGetValue(torrent, out var d))
                torrents[torrent] = d = new Dictionary<int, Item>();
            return d;
        }

        /// <summary>A block was written: the piece's stored size is now at least <paramref name="extent"/> bytes.</summary>
        public void OnWrite(string torrent, int piece, long extent)
        {
            lock (gate)
            {
                var d = Pieces(torrent);
                if (!d.TryGetValue(piece, out var item))
                    d[piece] = item = new Item();
                if (extent > item.Bytes)
                {
                    used += extent - item.Bytes;
                    item.Bytes = extent;
                }
                item.LastUse = ++clock;
            }
        }

        /// <summary>A stored piece was read (it becomes the most recently used).</summary>
        public void OnRead(string torrent, int piece)
        {
            lock (gate)
                if (torrents.TryGetValue(torrent, out var d) && d.TryGetValue(piece, out var item))
                    item.LastUse = ++clock;
        }

        /// <summary>A piece passed its hash check (only complete pieces are evicted or restored after a restart).</summary>
        public void OnComplete(string torrent, int piece, long bytes)
        {
            lock (gate)
            {
                var d = Pieces(torrent);
                if (!d.TryGetValue(piece, out var item))
                    d[piece] = item = new Item { LastUse = ++clock };
                used += bytes - item.Bytes;
                item.Bytes = bytes;
                item.Complete = true;
            }
        }

        /// <summary>Records a complete piece found on disk at startup (oldest use).</summary>
        public void AddExisting(string torrent, int piece, long bytes)
        {
            lock (gate)
            {
                var d = Pieces(torrent);
                if (d.TryGetValue(piece, out var item))
                    used -= item.Bytes;
                d[piece] = new Item { Bytes = bytes, Complete = true, LastUse = 0 };
                used += bytes;
            }
        }

        public void Remove(string torrent, int piece)
        {
            lock (gate)
                if (torrents.TryGetValue(torrent, out var d) && d.TryGetValue(piece, out var item))
                {
                    used -= item.Bytes;
                    d.Remove(piece);
                }
        }

        /// <summary>Forgets the incomplete pieces of a torrent (the engine drops partial progress when it stops).</summary>
        public List<int> RemoveIncomplete(string torrent)
        {
            lock (gate)
            {
                var gone = new List<int>();
                if (torrents.TryGetValue(torrent, out var d))
                    foreach (var kv in d.Where(kv => !kv.Value.Complete).ToList())
                    {
                        used -= kv.Value.Bytes;
                        d.Remove(kv.Key);
                        gone.Add(kv.Key);
                    }
                return gone;
            }
        }

        public void RemoveTorrent(string torrent)
        {
            lock (gate)
            {
                if (torrents.TryGetValue(torrent, out var d))
                {
                    foreach (var item in d.Values)
                        used -= item.Bytes;
                    torrents.Remove(torrent);
                }
                windows.Remove(torrent);
            }
        }

        public bool IsComplete(string torrent, int piece)
        {
            lock (gate)
                return torrents.TryGetValue(torrent, out var d) && d.TryGetValue(piece, out var item) && item.Complete;
        }

        public List<int> CompletePieces(string torrent)
        {
            lock (gate)
                return torrents.TryGetValue(torrent, out var d) ? d.Where(kv => kv.Value.Complete).Select(kv => kv.Key).OrderBy(i => i).ToList() : new List<int>();
        }

        public int PieceCount(string torrent)
        {
            lock (gate)
                return torrents.TryGetValue(torrent, out var d) ? d.Count : 0;
        }

        /// <summary>Protects pieces [first, last] of a torrent for stream <paramref name="stream"/> (one window per stream).</summary>
        public void SetWindow(string torrent, int stream, int first, int last)
        {
            lock (gate)
            {
                if (!windows.TryGetValue(torrent, out var d))
                    windows[torrent] = d = new Dictionary<int, Window>();
                d[stream] = new Window { First = first, Last = last };
            }
        }

        public void ClearWindow(string torrent, int stream)
        {
            lock (gate)
                if (windows.TryGetValue(torrent, out var d))
                {
                    d.Remove(stream);
                    if (d.Count == 0)
                        windows.Remove(torrent);
                }
        }

        bool Protected(string torrent, int piece)
        {
            if (!windows.TryGetValue(torrent, out var d))
                return false;
            foreach (var w in d.Values)
                if (piece >= w.First && piece <= w.Last)
                    return true;
            return false;
        }

        /// <summary>
        /// Chooses complete, unprotected pieces, least recently used first, to delete so that
        /// <paramref name="incoming"/> more bytes fit under <see cref="Capacity"/>. They're removed from the index;
        /// the caller deletes the files and tells the engine. May free less than needed if everything left is protected.
        /// </summary>
        public List<KeyValuePair<string, int>> Evict(long incoming)
        {
            long cap = Capacity;
            lock (gate)
            {
                var chosen = new List<KeyValuePair<string, int>>();
                if (used + incoming <= cap)
                    return chosen;
                var candidates = new List<(string torrent, int piece, Item item)>();
                foreach (var t in torrents)
                    foreach (var p in t.Value)
                        if (p.Value.Complete && !Protected(t.Key, p.Key))
                            candidates.Add((t.Key, p.Key, p.Value));
                candidates.Sort((a, b) => a.item.LastUse.CompareTo(b.item.LastUse));
                foreach (var c in candidates)
                {
                    if (used + incoming <= cap)
                        break;
                    used -= c.item.Bytes;
                    torrents[c.torrent].Remove(c.piece);
                    chosen.Add(new KeyValuePair<string, int>(c.torrent, c.piece));
                }
                return chosen;
            }
        }
    }
}
