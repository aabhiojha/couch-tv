using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using CouchTor.Streams;
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
    /// Turns a PPV embed page (e.g. https://taifood-blog.asia/embed/247-willow) into an HLS URL, as its player does:
    /// the page's WebAssembly (/js/wasm/gasm.wasm) gets <c>set_stream_jw(slug)</c>, POSTs to {embed host}/fetch, decrypts
    /// the answer and hands the URL to JW Player as its <c>file</c>. That module runs here in WACS inside a minimal
    /// browser stand-in (<see cref="JsHost"/>), so no browser is needed. Stream URLs are tied to the IP that resolved
    /// them, which is why this runs on the TV that plays them. (Streamed's embed.st used the same player until Streamed
    /// closed on 2026-11-04.)
    /// </summary>
    public sealed class PpvResolver
    {
        public const string UserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

        readonly HttpClient http;
        readonly LogRing log;
        readonly SemaphoreSlim moduleLock = new SemaphoreSlim(1);
        byte[] module;
        string moduleHost;
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

        public PpvResolver(LogRing log, HttpMessageHandler handler = null)
        {
            this.log = log;
            http = new HttpClient(handler ?? new HttpClientHandler { UseCookies = false, AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate }, disposeHandler: false)
            { Timeout = TimeSpan.FromSeconds(20) };
        }

        /// <summary>What the stream's CDN wants: the embed host as Referer and Origin.</summary>
        public static Dictionary<string, string> StreamHeaders(string embedHost) => new Dictionary<string, string>
        {
            ["User-Agent"] = UserAgent,
            ["Origin"] = "https://" + embedHost,
            ["Referer"] = "https://" + embedHost + "/",
        };

        /// <summary>The embed page's host and the slug its player is given: the path after /embed/.</summary>
        public static (string host, string slug) Parse(string embedUrl)
        {
            if (!Uri.TryCreate(embedUrl, UriKind.Absolute, out var uri) || uri.Scheme != "https")
                throw new ServiceException(502, "not an embed URL");
            var path = uri.AbsolutePath;
            int at = path.IndexOf("/embed/", StringComparison.Ordinal);
            if (at < 0 || path.Length == at + 7)
                throw new ServiceException(502, "unexpected embed URL");
            return (uri.Host, Uri.UnescapeDataString(path.Substring(at + 7)));
        }

        public async Task<ResolvedStream> ResolveAsync(string embedUrl, CancellationToken token)
        {
            var started = DateTime.UtcNow;
            var (host, slug) = Parse(embedUrl);
            string url;
            try
            {
                var wasm = await ModuleAsync(host, false, token).ConfigureAwait(false);
                try { url = await RunAsync(wasm, embedUrl, host, slug, token).ConfigureAwait(false); }
                catch (Exception e) when (!token.IsCancellationRequested)
                {
                    // The site may have shipped a new module: fetch it once and try again before giving up.
                    log.Add("ppv " + slug + ": " + e.GetBaseException().Message + "; refreshing the module");
                    var fresh = await ModuleAsync(host, true, token).ConfigureAwait(false);
                    url = await RunAsync(fresh, embedUrl, host, slug, token).ConfigureAwait(false);
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
            log.Add("ppv " + slug + " resolved in " + OkMs + " ms");
            return new ResolvedStream { Url = url, Headers = StreamHeaders(host) };
        }

        Task<string> RunAsync(byte[] wasm, string embedUrl, string embedHost, string slug, CancellationToken token)
            => Task.Factory.StartNew(() =>
            {
                var host = new JsHost(wasm, embedHost, UserAgent, (r, t) => FetchAsync(r, embedUrl, embedHost, t), skipValidation: true);
                if (!host.HasExport("set_stream_jw"))
                    throw new InvalidOperationException("gasm.wasm has no set_stream_jw: the player changed");
                // The module asks the page's P2P engine to register a service worker before it hands over the stream.
                var p2p = new JsObject("P2PEngineHls");
                p2p.Set("tryRegisterServiceWorker", new JsFunction("tryRegisterServiceWorker", a =>
                {
                    var p = new JsPromise(host);
                    p.Resolve(false);
                    return p;
                }));
                host.Window.Set("P2PEngineHls", p2p);
                string Found() => host.Files.FirstOrDefault(u => u.Contains(".m3u8"));
                host.Run(() =>
                {
                    host.Export("__wbindgen_start")(new Value[0]);
                    if (host.HasExport("init_wasm"))
                        host.Export("init_wasm")(new Value[0]);
                    var (ptr, len) = host.PassString(slug);
                    host.Export("set_stream_jw")(new[] { new Value(ptr), new Value(len) });
                }, () => Found() != null, Timeout, token);
                log.Add("ppv timings: " + string.Join(", ", host.Timings));
                return Found();
            }, token, TaskCreationOptions.LongRunning, TaskScheduler.Default);

        async Task<JsResponse> FetchAsync(JsRequest request, string embedUrl, string embedHost, CancellationToken token)
        {
            var message = new HttpRequestMessage(new HttpMethod(request.Method), request.Url);
            message.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
            message.Headers.TryAddWithoutValidation("Origin", "https://" + embedHost);
            message.Headers.TryAddWithoutValidation("Referer", embedUrl);
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

        /// <summary>The embed host's module, cached; a different host (PPV moves its embeds) fetches it anew.</summary>
        async Task<byte[]> ModuleAsync(string embedHost, bool refresh, CancellationToken token)
        {
            await moduleLock.WaitAsync(token).ConfigureAwait(false);
            try
            {
                if (module != null && !refresh && moduleHost == embedHost && DateTime.UtcNow - moduleAt < ModuleAge)
                    return module;
                var message = new HttpRequestMessage(HttpMethod.Get, "https://" + embedHost + "/js/wasm/gasm.wasm");
                foreach (var h in StreamHeaders(embedHost))
                    message.Headers.TryAddWithoutValidation(h.Key, h.Value);
                try
                {
                    using (var response = await http.SendAsync(message, token).ConfigureAwait(false))
                    {
                        response.EnsureSuccessStatusCode();
                        module = await response.Content.ReadAsByteArrayAsync().ConfigureAwait(false);
                        moduleHost = embedHost;
                        moduleAt = DateTime.UtcNow;
                        using (var sha = SHA256.Create())
                            ModuleHash = string.Concat(sha.ComputeHash(module).Take(4).Select(b => b.ToString("x2")));
                        log.Add("ppv resolver module: " + module.Length + " bytes from " + embedHost);
                    }
                }
                catch (Exception e) when (module != null && moduleHost == embedHost && !token.IsCancellationRequested)
                {
                    log.Add("ppv resolver module refresh failed (" + e.GetBaseException().Message + "); keeping the old one");
                }
                return module;
            }
            finally { moduleLock.Release(); }
        }
    }
}
