using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace CouchTor
{
    /// <summary>Stats of one torrent, in the Stremio server's field names.</summary>
    public sealed class TorrentStats
    {
        public int Peers;
        public long DownloadSpeed, UploadSpeed, Downloaded, Uploaded;
        public string State = "metadata"; // metadata | downloading | error | stopped
        public string Error = "";
        public string Name;
        public long? StreamLen;
        public double? StreamProgress;
        public string StreamName;

        public string ToJson(bool withStream)
        {
            var j = Json.Object()
                .Add("peers", Peers).Add("downloadSpeed", DownloadSpeed).Add("uploadSpeed", UploadSpeed)
                .Add("downloaded", Downloaded).Add("uploaded", Uploaded)
                .Add("state", State).Add("error", Error ?? "");
            if (Name != null)
                j.Add("name", Name);
            if (withStream)
            {
                j.Add("streamLen", StreamLen ?? 0).Add("streamProgress", StreamProgress ?? 0);
                if (StreamName != null)
                    j.Add("streamName", StreamName);
            }
            return j.ToString();
        }
    }

    /// <summary>One file of a torrent opened for reading.</summary>
    public interface IStreamFile : IDisposable
    {
        string Name { get; }
        long Length { get; }
        /// <summary>Reads at <paramref name="position"/>, waiting for the pieces to download. Returns at least 1 byte unless at the end.</summary>
        Task<int> ReadAsync(long position, byte[] buffer, int offset, int count, CancellationToken token);
    }

    /// <summary>An error with the HTTP status to answer.</summary>
    public sealed class ServiceException : Exception
    {
        public int Status { get; }
        public ServiceException(int status, string message) : base(message) { Status = status; }
    }

    public interface ITorrentBackend
    {
        /// <summary>Adds the torrent if needed, waits for its metadata, opens file <paramref name="fileIdx"/> (-1 = largest video).</summary>
        Task<IStreamFile> OpenAsync(string infoHash, int fileIdx, IReadOnlyList<string> trackers, CancellationToken token);
        /// <summary>Null when the torrent isn't known. With <paramref name="fileIdx"/>, fills the stream fields.</summary>
        TorrentStats Stats(string infoHash, int? fileIdx);
        IReadOnlyList<KeyValuePair<string, TorrentStats>> AllStats();
        Task RemoveAsync(string infoHash);
        /// <summary>Free-form diagnostics for <c>/debug</c>.</summary>
        string Debug(IReadOnlyList<KeyValuePair<string, string>> query);
    }
}
