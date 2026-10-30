using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using CouchTor.Streams;

namespace CouchTor.Sports
{
    /// <summary>
    /// The TV's sports endpoints (docs/tv-torrent-service.md): <c>/sports.json</c>, the schedule the app's Sports screen
    /// reads, and <c>/sports/play/{feed}.m3u8</c>, which resolves a feed on this TV (stream URLs are tied to the IP
    /// that resolved them) and relays it with the headers its host wants.
    /// </summary>
    public sealed class SportsRoutes : IHttpRoutes
    {
        readonly SportsCatalog catalog;
        readonly StreamedResolver resolver;
        readonly StreamServer relay;
        readonly LogRing log;
        readonly Dictionary<string, (DateTime at, string link)> resolved = new Dictionary<string, (DateTime, string)>();
        // One resolution at a time: each runs the site's WebAssembly in an interpreter on the TV's CPU.
        readonly SemaphoreSlim resolving = new SemaphoreSlim(1);

        /// <summary>A resolved URL is reused for this long (they stay valid for hours); a refused one is resolved again.</summary>
        public TimeSpan Reuse = TimeSpan.FromMinutes(30);

        public SportsRoutes(SportsCatalog catalog, StreamedResolver resolver, StreamServer relay, LogRing log)
        {
            this.catalog = catalog;
            this.resolver = resolver;
            this.relay = relay;
            this.log = log;
        }

        public async Task<bool> TryHandleAsync(HttpRequest req, string[] path, Stream net)
        {
            if (path.Length == 1 && path[0] == "sports.json")
            {
                var json = await catalog.JsonAsync("http://" + (req.Header("Host") ?? "127.0.0.1"), CancellationToken.None).ConfigureAwait(false);
                await HttpService.SendAsync(net, 200, "application/json", json).ConfigureAwait(false);
                return true;
            }
            if (path.Length == 3 && path[0] == "sports" && path[1] == "play" && path[2].EndsWith(".m3u8", StringComparison.Ordinal))
            {
                var feed = await catalog.FeedAsync(path[2].Substring(0, path[2].Length - 5), CancellationToken.None).ConfigureAwait(false);
                if (feed == null)
                    throw new ServiceException(404, "this listing is gone; refresh Sports");
                var link = await LinkAsync(feed, false).ConfigureAwait(false);
                await relay.RelayLinkAsync(req, net, link, () => LinkAsync(feed, true)).ConfigureAwait(false);
                return true;
            }
            if (path.Length == 2 && path[0] == "sports" && path[1] == "health")
            {
                // Settings › Sports streams: schedule and resolver state; ?test=1 first resolves a feed that is on air.
                var test = req.QueryAll("test").Any() ? await TestAsync().ConfigureAwait(false) : null;
                var (status, updatedAt) = catalog.Status;
                var schedule = Json.Object().Add("status", status);
                if (status != "none")
                    schedule.Add("updatedAt", Ms(updatedAt));
                var r = Json.Object();
                if (resolver.ModuleBytes > 0)
                    r.Raw("module", Json.Object().Add("bytes", (long)resolver.ModuleBytes).Add("hash", resolver.ModuleHash).Add("fetchedAt", Ms(resolver.ModuleAt)).ToString());
                if (resolver.OkAt.HasValue)
                    r.Raw("lastOk", Json.Object().Add("at", Ms(resolver.OkAt.Value)).Add("ms", (long)resolver.OkMs).ToString());
                if (resolver.ErrorAt.HasValue)
                    r.Raw("lastError", Json.Object().Add("at", Ms(resolver.ErrorAt.Value)).Add("message", resolver.Error).ToString());
                var body = Json.Object().Raw("schedule", schedule.ToString()).Raw("resolver", r.ToString());
                if (test != null)
                    body.Raw("test", test);
                await HttpService.SendAsync(net, 200, "application/json", body.ToString()).ConfigureAwait(false);
                return true;
            }
            if (path.Length == 2 && path[0] == "sports" && path[1] == "resolve")
            {
                // Diagnostics: resolve one Streamed source and report the time and host (never the signed URL).
                var started = DateTime.UtcNow;
                var r = await Resolving(() => resolver.ResolveAsync(req.QueryAll("source").FirstOrDefault() ?? "admin",
                    req.QueryAll("id").FirstOrDefault() ?? "", req.QueryAll("stream").FirstOrDefault() ?? "1", CancellationToken.None)).ConfigureAwait(false);
                await HttpService.SendAsync(net, 200, "application/json", Json.Object().Add("ms", (long)(DateTime.UtcNow - started).TotalMilliseconds)
                    .Add("host", new Uri(r.Url).Host).ToString()).ConfigureAwait(false);
                return true;
            }
            return false;
        }

        async Task<string> LinkAsync(Feed feed, bool fresh)
        {
            await resolving.WaitAsync().ConfigureAwait(false);
            try
            {
                lock (resolved)
                    if (!fresh && resolved.TryGetValue(feed.Id, out var hit) && DateTime.UtcNow - hit.at < Reuse && relay.Links.Get(hit.link) != null)
                        return hit.link;
                var (source, id, streamNo) = await catalog.StreamAsync(feed, CancellationToken.None).ConfigureAwait(false);
                var r = await Resolving(() => resolver.ResolveAsync(source, id, streamNo, CancellationToken.None)).ConfigureAwait(false);
                var link = relay.Links.Add(r.Url, r.Headers);
                lock (resolved)
                    resolved[feed.Id] = (DateTime.UtcNow, link);
                return link;
            }
            finally { resolving.Release(); }
        }

        static double Ms(DateTime utc) => new DateTimeOffset(utc).ToUnixTimeMilliseconds();

        async Task<string> TestAsync()
        {
            var started = DateTime.UtcNow;
            try
            {
                var item = await catalog.TestItemAsync(CancellationToken.None).ConfigureAwait(false);
                if (item == null)
                    return Json.Object().Add("ok", false).Add("message", "nothing on air to test with").ToString();
                await LinkAsync(item.Feeds[0], true).ConfigureAwait(false);
                return Json.Object().Add("ok", true).Add("title", item.Title).Add("ms", (long)(DateTime.UtcNow - started).TotalMilliseconds).ToString();
            }
            catch (Exception e)
            {
                return Json.Object().Add("ok", false).Add("message", e.GetBaseException().Message).ToString();
            }
        }

        /// <summary>A resolver failure is a 502 (504 on a timeout) with a short reason, not a dropped connection.</summary>
        async Task<T> Resolving<T>(Func<Task<T>> call)
        {
            try { return await call().ConfigureAwait(false); }
            catch (ServiceException) { throw; }
            catch (TimeoutException e) { throw new ServiceException(504, "resolving the stream timed out: " + e.Message); }
            catch (Exception e)
            {
                log.Add("sports resolve failed: " + e.GetBaseException().GetType().Name + ": " + e.GetBaseException().Message);
                throw new ServiceException(502, "couldn't resolve this stream: " + e.GetBaseException().Message);
            }
        }
    }

    /// <summary>Several route sets behind one <see cref="HttpService"/>, asked in order.</summary>
    public sealed class Routes : IHttpRoutes
    {
        readonly IHttpRoutes[] all;
        public Routes(params IHttpRoutes[] all) { this.all = all; }

        public async Task<bool> TryHandleAsync(HttpRequest req, string[] path, Stream net)
        {
            foreach (var r in all)
                if (await r.TryHandleAsync(req, path, net).ConfigureAwait(false))
                    return true;
            return false;
        }
    }
}
