using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace CouchTor
{
    /// <summary>More routes for <see cref="HttpService"/> (the stream server); false to answer 404.</summary>
    public interface IHttpRoutes
    {
        Task<bool> TryHandleAsync(HttpRequest req, string[] path, Stream net);
    }

    /// <summary>The service's HTTP API (see docs/tv-torrent-service.md). One request per connection.</summary>
    public sealed class HttpService
    {
        readonly ITorrentBackend backend;
        readonly IHttpRoutes routes;
        readonly LogRing log;
        TcpListener listener;
        readonly Dictionary<string, CancellationTokenSource> streams = new Dictionary<string, CancellationTokenSource>();
        int connections;

        public int ChunkSize = 64 * 1024;
        public TimeSpan HeadTimeout = TimeSpan.FromSeconds(30);
        public TimeSpan WriteTimeout = TimeSpan.FromSeconds(60);
        public int Port { get; private set; }
        public int OpenConnections => Volatile.Read(ref connections);

        public HttpService(ITorrentBackend backend, LogRing log, IHttpRoutes routes = null)
        {
            this.backend = backend;
            this.log = log;
            this.routes = routes;
        }

        public void Start(IPAddress address, int port)
        {
            listener = new TcpListener(address, port);
            listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            listener.Start(64);
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var thread = new Thread(AcceptLoop) { IsBackground = true, Name = "http accept" };
            thread.Start();
        }

        public void Stop() => listener?.Stop();

        void AcceptLoop()
        {
            while (true)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch (ObjectDisposedException) { return; }
                catch (SocketException e) when (e.SocketErrorCode == SocketError.Interrupted || e.SocketErrorCode == SocketError.OperationAborted) { return; }
                catch (Exception e) { log.Add("accept: " + e.Message); Thread.Sleep(100); continue; }
                Task.Run(() => HandleAsync(client));
            }
        }

        async Task HandleAsync(TcpClient client)
        {
            Interlocked.Increment(ref connections);
            try
            {
                using (client)
                {
                    client.NoDelay = true;
                    var remote = ((IPEndPoint)client.Client.RemoteEndPoint).Address;
                    if (!AddressFilter.IsAllowed(remote))
                    {
                        log.Add("refused " + remote);
                        return;
                    }
                    var net = client.GetStream();
                    HttpRequest req;
                    using (var headTimeout = new CancellationTokenSource(HeadTimeout))
                    {
                        try { req = await HttpRequest.ReadAsync(net, headTimeout.Token).ConfigureAwait(false); }
                        catch (InvalidDataException e)
                        {
                            await SendAsync(net, 400, "text/plain", e.Message).ConfigureAwait(false);
                            return;
                        }
                    }
                    if (req == null)
                        return;
                    await RouteAsync(req, net).ConfigureAwait(false);
                }
            }
            catch (Exception e) when (e is IOException || e is SocketException || e is ObjectDisposedException || e is OperationCanceledException) { }
            catch (Exception e) { log.Add("request failed: " + e); }
            finally { Interlocked.Decrement(ref connections); }
        }

        /// <summary>Handles one parsed request, writing the response to <paramref name="net"/>.</summary>
        public async Task RouteAsync(HttpRequest req, Stream net)
        {
            if (req.Method == "OPTIONS")
            {
                var allow = req.Header("Access-Control-Request-Headers");
                await SendAsync(net, 200, "text/plain", "", "Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n" +
                    (allow != null ? "Access-Control-Allow-Headers: " + allow + "\r\n" : "") + "Access-Control-Max-Age: 600\r\n").ConfigureAwait(false);
                return;
            }
            if (req.Method != "GET" && req.Method != "HEAD")
            {
                await SendAsync(net, 405, "text/plain", "method not allowed").ConfigureAwait(false);
                return;
            }
            var path = req.Path.Trim('/').Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            try
            {
                if (path.Length == 1 && path[0] == "heartbeat")
                    await SendAsync(net, 200, "application/json", "{\"success\":true}").ConfigureAwait(false);
                else if (path.Length == 1 && path[0] == "stats.json")
                    await SendAsync(net, 200, "application/json", AllStatsJson()).ConfigureAwait(false);
                else if (path.Length == 1 && path[0] == "log")
                    await SendAsync(net, 200, "text/plain; charset=utf-8", log.Text()).ConfigureAwait(false);
                else if (path.Length == 1 && path[0] == "trailer.html")
                    await SendAsync(net, 200, "text/html; charset=utf-8", TrailerPage(req.QueryAll("v").FirstOrDefault())).ConfigureAwait(false);
                else if (path.Length == 1 && path[0] == "debug")
                    await SendAsync(net, 200, "text/plain; charset=utf-8", backend.Debug(req.Query)).ConfigureAwait(false);
                else if (path.Length >= 2 && IsInfoHash(path[0]))
                    await TorrentAsync(req, net, path[0].ToLowerInvariant(), path).ConfigureAwait(false);
                else if (routes != null && await routes.TryHandleAsync(req, path, net).ConfigureAwait(false))
                    return;
                else
                    await SendAsync(net, 404, "text/plain", "not found").ConfigureAwait(false);
            }
            catch (ServiceException e)
            {
                log.Add(req.Path + ": " + e.Status + " " + e.Message);
                await SendAsync(net, e.Status, "application/json", Json.Object().Add("error", e.Message).ToString()).ConfigureAwait(false);
            }
        }

        static readonly System.Text.RegularExpressions.Regex VideoId = new System.Text.RegularExpressions.Regex("^[A-Za-z0-9_-]{11}$");

        /// <summary>
        /// The app's trailer player: YouTube's embed refuses pages without an http origin (error 153), and the app's
        /// own pages are file://, so it frames this one. It tells the app "trailer:playing|ended|error" and takes
        /// "toggle" (play/pause) by postMessage.
        /// </summary>
        public static string TrailerPage(string id)
        {
            if (id == null || !VideoId.IsMatch(id))
                throw new ServiceException(400, "v must be a YouTube video id");
            return @"<!doctype html><meta charset=""utf-8""><style>html,body{margin:0;background:#000;overflow:hidden}iframe{border:0;width:1920px;height:1080px}</style>
<iframe id=""p"" allow=""autoplay"" tabindex=""-1"" src=""https://www.youtube.com/embed/" + id + @"?autoplay=1&controls=0&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&enablejsapi=1""></iframe>
<script>
var p = document.getElementById('p'), playing = false;
function command(f) { p.contentWindow.postMessage(JSON.stringify({ event: 'command', func: f, args: [] }), '*'); }
p.onload = function () { p.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'); };
window.addEventListener('message', function (e) {
  if (e.source === parent) { if (e.data === 'toggle') command(playing ? 'pauseVideo' : 'playVideo'); return; }
  var d; try { d = JSON.parse(e.data); } catch (x) { return; }
  if (d.event === 'onError') parent.postMessage('trailer:error', '*');
  var state = d.info && d.info.playerState;
  if (state === 1) { playing = true; parent.postMessage('trailer:playing', '*'); }
  else if (state === 2) playing = false;
  else if (state === 0) parent.postMessage('trailer:ended', '*');
});
</script>";
        }

        string AllStatsJson()
        {
            var sb = new StringBuilder("{");
            bool first = true;
            foreach (var kv in backend.AllStats())
            {
                if (!first) sb.Append(',');
                first = false;
                Json.Str(sb, kv.Key);
                sb.Append(':').Append(kv.Value.ToJson(false));
            }
            return sb.Append('}').ToString();
        }

        async Task TorrentAsync(HttpRequest req, Stream net, string hash, string[] path)
        {
            if (path.Length == 2 && path[1] == "remove")
            {
                await backend.RemoveAsync(hash).ConfigureAwait(false);
                await SendAsync(net, 200, "application/json", "{}").ConfigureAwait(false);
                return;
            }
            if (path.Length == 2 && path[1] == "stats.json")
            {
                var s = backend.Stats(hash, null);
                await SendAsync(net, s == null ? 404 : 200, "application/json", s == null ? "{\"error\":\"unknown torrent\"}" : s.ToJson(false)).ConfigureAwait(false);
                return;
            }
            if (!int.TryParse(path[1], NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out int fileIdx) || fileIdx < -1)
            {
                await SendAsync(net, 404, "text/plain", "not found").ConfigureAwait(false);
                return;
            }
            if (path.Length == 3 && path[2] == "stats.json")
            {
                var s = backend.Stats(hash, fileIdx);
                await SendAsync(net, s == null ? 404 : 200, "application/json", s == null ? "{\"error\":\"unknown torrent\"}" : s.ToJson(true)).ConfigureAwait(false);
                return;
            }
            if (path.Length != 2)
            {
                await SendAsync(net, 404, "text/plain", "not found").ConfigureAwait(false);
                return;
            }
            await StreamAsync(req, net, hash, fileIdx).ConfigureAwait(false);
        }

        async Task StreamAsync(HttpRequest req, Stream net, string hash, int fileIdx)
        {
            // A new request for the same file ends the previous one (AVPlay seeks by opening a new Range request).
            // HEAD sends no body, so it neither ends nor replaces the stream being played.
            var key = hash + "/" + fileIdx;
            bool head = req.Method == "HEAD";
            var cts = new CancellationTokenSource();
            if (!head)
                lock (streams)
                {
                    if (streams.TryGetValue(key, out var previous))
                        previous.Cancel();
                    streams[key] = cts;
                }
            // .NET Core 3.1 can't cancel a socket write in progress: closing the socket ends it.
            var closer = cts.Token.Register(() => net.Dispose());
            try
            {
                using (var file = await backend.OpenAsync(hash, fileIdx, req.QueryAll("tr"), cts.Token).ConfigureAwait(false))
                {
                    var range = ByteRange.Parse(req.Header("Range"), file.Length);
                    if (range.Result == ByteRange.Kind.Unsatisfiable)
                    {
                        await SendAsync(net, 416, "text/plain", "", "Content-Range: bytes */" + file.Length + "\r\n").ConfigureAwait(false);
                        return;
                    }
                    bool partial = range.Result == ByteRange.Kind.Satisfiable;
                    var headers = new StringBuilder();
                    headers.Append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
                    if (partial)
                        headers.Append("Content-Range: bytes ").Append(range.Start).Append('-').Append(range.End).Append('/').Append(file.Length).Append("\r\n");
                    headers.Append("Content-Type: ").Append(ContentTypes.For(file.Name)).Append("\r\n")
                        .Append("Accept-Ranges: bytes\r\n")
                        .Append("Content-Length: ").Append(file.Length == 0 ? 0 : range.Length).Append("\r\n")
                        .Append("Access-Control-Allow-Origin: *\r\n")
                        .Append("Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\n")
                        .Append("Cache-Control: no-store\r\n")
                        .Append("Connection: close\r\n\r\n");
                    var headBytes = Encoding.ASCII.GetBytes(headers.ToString());
                    await WriteAsync(net, headBytes, headBytes.Length, cts).ConfigureAwait(false);
                    if (head || file.Length == 0)
                        return;
                    var buf = new byte[ChunkSize];
                    long pos = range.Start, end = range.End;
                    while (pos <= end)
                    {
                        int want = (int)Math.Min(buf.Length, end - pos + 1);
                        int n;
                        try { n = await file.ReadAsync(pos, buf, 0, want, cts.Token).ConfigureAwait(false); }
                        catch (Exception e) when (!(e is OperationCanceledException))
                        {
                            log.Add(key + " stream failed at " + pos + ": " + e.Message);
                            throw;
                        }
                        if (n <= 0)
                        {
                            log.Add(key + " stream: no data at " + pos);
                            throw new IOException("read returned no data at " + pos);
                        }
                        await WriteAsync(net, buf, n, cts).ConfigureAwait(false);
                        pos += n;
                    }
                }
            }
            finally
            {
                closer.Dispose();
                lock (streams)
                    if (streams.TryGetValue(key, out var current) && current == cts)
                        streams.Remove(key);
                cts.Dispose();
            }
        }

        /// <summary>
        /// A client that stops reading but keeps the socket open would block a write forever, keeping the torrent
        /// "streaming" (no idle stop) and its cache window protected: a write that makes no progress for
        /// <see cref="WriteTimeout"/> closes the connection.
        /// </summary>
        async Task WriteAsync(Stream net, byte[] buffer, int count, CancellationTokenSource cts)
        {
            var write = net.WriteAsync(buffer, 0, count, cts.Token);
            if (await Task.WhenAny(write, Task.Delay(WriteTimeout)).ConfigureAwait(false) != write)
            {
                cts.Cancel(); // closes the socket (see StreamAsync), which fails the write
                try { await write.ConfigureAwait(false); } catch { }
                log.Add("closing a connection whose client stopped reading for " + WriteTimeout.TotalSeconds + " s");
                throw new IOException("client stopped reading for " + WriteTimeout.TotalSeconds + " s");
            }
            await write.ConfigureAwait(false);
        }

        static bool IsInfoHash(string s)
        {
            if (s.Length != 40)
                return false;
            foreach (var c in s)
                if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')))
                    return false;
            return true;
        }

        internal static string Reason(int status)
        {
            switch (status)
            {
                case 200: return "OK";
                case 206: return "Partial Content";
                case 410: return "Gone";
                case 502: return "Bad Gateway";
                case 400: return "Bad Request";
                case 403: return "Forbidden";
                case 404: return "Not Found";
                case 405: return "Method Not Allowed";
                case 416: return "Range Not Satisfiable";
                case 500: return "Internal Server Error";
                case 503: return "Service Unavailable";
                case 504: return "Gateway Timeout";
                default: return "Status";
            }
        }

        internal static Task SendAsync(Stream net, int status, string type, string body, string extraHeaders = "")
            => SendBytesAsync(net, status, type, Encoding.UTF8.GetBytes(body), false, extraHeaders);

        internal static async Task SendBytesAsync(Stream net, int status, string type, byte[] bytes, bool head, string extraHeaders = "")
        {
            var start = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " " + Reason(status) + "\r\nContent-Type: " + type +
                "\r\nContent-Length: " + bytes.Length + "\r\nAccess-Control-Allow-Origin: *\r\nCache-Control: no-store\r\n" + extraHeaders + "Connection: close\r\n\r\n");
            await net.WriteAsync(start, 0, start.Length).ConfigureAwait(false);
            if (bytes.Length > 0 && !head)
                await net.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
            await net.FlushAsync().ConfigureAwait(false);
        }
    }
}
