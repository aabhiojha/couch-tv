using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Wacs.Core.Runtime;

namespace CouchTor.Sports
{
    /// <summary>A resolved live stream: its HLS URL and the headers its host wants.</summary>
    public sealed class ResolvedStream
    {
        public string Url;
        public Dictionary<string, string> Headers;
    }

    /// <summary>
    /// Turns a Streamed source (e.g. "admin", "admin-willow-cricket", "1") into an HLS URL, as embed.st's player
    /// does: its WebAssembly (lock.wasm) POSTs the source to embed.st/fetch and decrypts the answer. That module
    /// runs here in WACS inside a minimal browser stand-in (<see cref="JsHost"/>), so no browser is needed.
    /// Stream URLs are tied to the IP that resolved them, which is why this runs on the TV that plays them.
    /// </summary>
    public sealed class StreamedResolver
    {
        public const string Embed = "embed.st";
        const string WasmUrl = "https://strmd.b-cdn.net/js/wasm/lock.wasm";
        public const string UserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

        readonly HttpClient http;
        readonly LogRing log;
        readonly SemaphoreSlim moduleLock = new SemaphoreSlim(1);
        byte[] module;
        DateTime moduleAt;

        /// <summary>The module is fetched again after this, or when a resolution fails, in case the site updated it.</summary>
        public TimeSpan ModuleAge = TimeSpan.FromHours(6);
        public TimeSpan Timeout = TimeSpan.FromSeconds(25);

        // For /sports/health: the module in use and the last outcome of each kind (UTC).
        public int ModuleBytes => module?.Length ?? 0;
        public string ModuleHash { get; private set; } = "";
        public DateTime ModuleAt => moduleAt;
        public DateTime? OkAt { get; private set; }
        public int OkMs { get; private set; }
        public DateTime? ErrorAt { get; private set; }
        public string Error { get; private set; }

        public StreamedResolver(LogRing log, HttpMessageHandler handler = null)
        {
            this.log = log;
            http = new HttpClient(handler ?? new HttpClientHandler { UseCookies = false, AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate }, disposeHandler: false)
            { Timeout = TimeSpan.FromSeconds(20) };
        }

        public static Dictionary<string, string> StreamHeaders() => new Dictionary<string, string>
        {
            ["User-Agent"] = UserAgent,
            ["Origin"] = "https://" + Embed,
            ["Referer"] = "https://" + Embed + "/",
        };

        public async Task<ResolvedStream> ResolveAsync(string source, string id, string streamNo, CancellationToken token)
        {
            var started = DateTime.UtcNow;
            string url;
            try
            {
                var wasm = await ModuleAsync(false, token).ConfigureAwait(false);
                try { url = await RunAsync(wasm, source, id, streamNo, token).ConfigureAwait(false); }
                catch (Exception e) when (!token.IsCancellationRequested)
                {
                    // The site may have shipped a new module: fetch it once and try again before giving up.
                    log.Add("streamed " + source + "/" + id + ": " + e.GetBaseException().Message + "; refreshing the module");
                    var fresh = await ModuleAsync(true, token).ConfigureAwait(false);
                    url = await RunAsync(fresh, source, id, streamNo, token).ConfigureAwait(false);
                }
            }
            catch (Exception e) when (!token.IsCancellationRequested)
            {
                ErrorAt = DateTime.UtcNow;
                Error = e.GetBaseException().Message;
                throw;
            }
            OkMs = (int)(DateTime.UtcNow - started).TotalMilliseconds;
            OkAt = DateTime.UtcNow;
            log.Add("streamed " + source + "/" + id + "/" + streamNo + " resolved in " + OkMs + " ms");
            return new ResolvedStream { Url = url, Headers = StreamHeaders() };
        }

        Task<string> RunAsync(byte[] wasm, string source, string id, string streamNo, CancellationToken token)
            => Task.Factory.StartNew(() =>
            {
                var host = new JsHost(wasm, Embed, UserAgent, FetchAsync, skipValidation: true);
                if (!host.HasExport("set_stream_jw"))
                    throw new InvalidOperationException("lock.wasm has no set_stream_jw: the player changed");
                string Found() => host.RequestUrls.FirstOrDefault(u => u.Contains("/secure/"));
                host.Run(() =>
                {
                    host.Export("__wbindgen_start")(new Value[0]);
                    if (host.HasExport("init_wasm"))
                        host.Export("init_wasm")(new Value[0]);
                    var args = new List<Value>();
                    foreach (var s in new[] { source, id, streamNo })
                    {
                        var (ptr, len) = host.PassString(s);
                        args.Add(new Value(ptr));
                        args.Add(new Value(len));
                    }
                    host.Export("set_stream_jw")(args.ToArray());
                }, () => Found() != null, Timeout, token);
                log.Add("streamed timings: " + string.Join(", ", host.Timings));
                return Found();
            }, token, TaskCreationOptions.LongRunning, TaskScheduler.Default);

        async Task<JsResponse> FetchAsync(JsRequest request, CancellationToken token)
        {
            var message = new HttpRequestMessage(new HttpMethod(request.Method), request.Url);
            foreach (var h in StreamHeaders())
                message.Headers.TryAddWithoutValidation(h.Key, h.Value);
            if (request.Body != null)
            {
                message.Content = new ByteArrayContent(request.Body);
                if (request.Headers.Values.TryGetValue("Content-Type", out var type))
                    message.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(type);
            }
            foreach (var h in request.Headers.Values.Where(h => !string.Equals(h.Key, "Content-Type", StringComparison.OrdinalIgnoreCase)))
                message.Headers.TryAddWithoutValidation(h.Key, h.Value);
            using (var response = await http.SendAsync(message, token).ConfigureAwait(false))
            {
                var result = new JsResponse { Status = (int)response.StatusCode, Url = request.Url, Body = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false) };
                foreach (var h in response.Headers.Concat(response.Content.Headers))
                    result.Headers.Values[h.Key] = string.Join(", ", h.Value);
                return result;
            }
        }

        async Task<byte[]> ModuleAsync(bool refresh, CancellationToken token)
        {
            await moduleLock.WaitAsync(token).ConfigureAwait(false);
            try
            {
                if (module != null && !refresh && DateTime.UtcNow - moduleAt < ModuleAge)
                    return module;
                var message = new HttpRequestMessage(HttpMethod.Get, WasmUrl);
                foreach (var h in StreamHeaders())
                    message.Headers.TryAddWithoutValidation(h.Key, h.Value);
                try
                {
                    using (var response = await http.SendAsync(message, token).ConfigureAwait(false))
                    {
                        response.EnsureSuccessStatusCode();
                        module = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                        moduleAt = DateTime.UtcNow;
                        using (var sha = SHA256.Create())
                            ModuleHash = string.Concat(sha.ComputeHash(module).Take(4).Select(b => b.ToString("x2")));
                        log.Add("streamed resolver module: " + module.Length + " bytes");
                    }
                }
                catch (Exception e) when (module != null && !token.IsCancellationRequested)
                {
                    log.Add("streamed resolver module refresh failed (" + e.GetBaseException().Message + "); keeping the old one");
                }
                return module;
            }
            finally { moduleLock.Release(); }
        }
    }
}
