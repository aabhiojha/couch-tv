// Couch TV additions: small public entry points into MonoTorrent internals for the TV service.
using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;

using MonoTorrent.Client;

namespace MonoTorrent
{
    public static class CouchExtensions
    {
        /// <summary>
        /// Asked when a torrent with metadata starts (after its hash state is known): the pieces already stored
        /// and verified, which are marked as downloaded without hashing them again.
        /// </summary>
        public static Func<TorrentManager, IEnumerable<int>?>? CachedPieces;
        /// <summary>Starts the listeners and DHT now and keeps them running when no torrent runs.</summary>
        public static async Task StartAndKeepRunningAsync (this ClientEngine engine)
        {
            await ClientEngine.MainLoop;
            engine.KeepRunning = true;
            await engine.StartAsync ();
        }

        /// <summary>Writes the DHT routing table where the engine loads it from on the next start. Returns the node count saved.</summary>
        public static async Task<int> SaveDhtNodesNowAsync (this ClientEngine engine)
        {
            await ClientEngine.MainLoop;
            var nodes = await engine.DhtEngine.SaveNodesAsync ();
            if (nodes.Length == 0)
                return 0;
            var path = engine.Settings.GetDhtNodeCacheFilePath ();
            await Task.Run (() => {
                Directory.CreateDirectory (Path.GetDirectoryName (path)!);
                File.WriteAllBytes (path + ".tmp", nodes.ToArray ());
                File.Copy (path + ".tmp", path, true);
                File.Delete (path + ".tmp");
            });
            return nodes.Length / 26; // compact node info: 20-byte id + 6-byte endpoint
        }

        /// <summary>The streaming requester of a torrent added with AddStreamingAsync (null otherwise).</summary>
        public static PiecePicking.IStreamingPieceRequester? StreamingRequester (this TorrentManager manager)
            => manager.PieceManager.Requester as PiecePicking.IStreamingPieceRequester;

        /// <summary>
        /// Asks the DHT for peers now, ignoring MonoTorrent's 3-minute minimum interval. The first lookup of a torrent
        /// added right after a start runs on an empty routing table and finds nothing; upstream then waits 3 minutes.
        /// </summary>
        public static async Task DhtLookupNowAsync (this TorrentManager manager)
        {
            await ClientEngine.MainLoop;
            manager.LastDhtAnnounceTimer = default;
            await manager.DhtAnnounceAsync ();
        }

        public static string DhtNodeCachePath (this ClientEngine engine)
            => engine.Settings.GetDhtNodeCacheFilePath ();

        /// <summary>Marks pieces as missing (evicted from the cache) so they're downloaded again when needed.</summary>
        public static async Task ForgetPiecesAsync (this TorrentManager manager, IReadOnlyList<int> pieces)
        {
            await ClientEngine.MainLoop;
            if (!manager.HasMetadata)
                return;
            foreach (var i in pieces)
                if (i >= 0 && i < manager.Bitfield.Length && manager.Bitfield[i])
                    manager.OnPieceHashed (i, false);
        }

        /// <summary>Marks pieces as present and verified (restored from the cache after a restart).</summary>
        public static async Task RestorePiecesAsync (this TorrentManager manager, IReadOnlyList<int> pieces)
        {
            await ClientEngine.MainLoop;
            if (!manager.HasMetadata)
                return;
            foreach (var i in pieces)
                if (i >= 0 && i < manager.Bitfield.Length && !manager.Bitfield[i])
                    manager.OnPieceHashed (i, true);
        }

        /// <summary>Reads file data straight from the engine's disk layer (which flushes its write cache first).</summary>
        public static async Task<bool> ReadFileAsync (this TorrentManager manager, ITorrentManagerFile file, long position, Memory<byte> buffer)
        {
            var engine = manager.Engine ?? throw new InvalidOperationException ("removed");
            int start = manager.Torrent!.ByteOffsetToPieceIndex (file.OffsetInTorrent + position);
            int end = manager.Torrent!.ByteOffsetToPieceIndex (file.OffsetInTorrent + position + buffer.Length - 1);
            await engine.DiskManager.FlushAsync (manager, start, end).ConfigureAwait (false);
            return await engine.DiskManager.ReadAsync (file, position, buffer).ConfigureAwait (false);
        }
    }
}
