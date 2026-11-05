using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace CouchTor.Streams
{
    /// <summary>
    /// The stream server the app asks for films and episodes (docs/streaming-provider.md), formerly CinePro on the
    /// laptop: <c>GET /</c>, <c>/v1/movies/{tmdb}</c>, <c>/v1/tv/{tmdb}/seasons/{s}/episodes/{e}</c>, and the relay
    /// <c>/v1/proxy[.m3u8]?data=@{id}[&amp;quality=all|{height}]</c>, which adds the headers upstream hosts want
    /// (AVPlay can't) and rewrites playlists to point back at itself.
    /// </summary>
    public sealed class StreamServer : IHttpRoutes
    {
        readonly SourceFinder finder;
        readonly Upstream upstream;
        readonly LogRing log;
        readonly ProxyLinks links = new ProxyLinks();
        readonly Dictionary<string, (Task<Fetched> task, DateTime at)> ahead = new Dictionary<string, (Task<Fetched>, DateTime)>();

        /// <summary>
        /// Upstream segments take over a second to start arriving and AVPlay fetches them one at a time, so a start
        /// or seek waited ~10 s. Fetching the next few in parallel hides that.
        /// </summary>
        public int ReadAhead = 4;
        public int MaxAhead = 12;
        public TimeSpan AheadWait = TimeSpan.FromSeconds(6);
        public TimeSpan AheadExpiry = TimeSpan.FromMinutes(2);

        public ProxyLinks Links => links;
        public Upstream Upstream => upstream;

        public StreamServer(SourceFinder finder, Upstream upstream, LogRing log)
        {
            this.finder = finder;
            this.upstream = upstream;
            this.log = log;
        }

        public async Task<bool> TryHandleAsync(HttpRequest req, string[] path, Stream net)
        {
            if (path.Length == 0)
            {
                await HttpService.SendAsync(net, 200, "application/json", "{\"name\":\"Couch TV stream server\",\"ok\":true}").ConfigureAwait(false);
                return true;
            }
            if (path[0] != "v1")
                return false;
            if (path.Length == 3 && path[1] == "movies")
            {
                await SourcesAsync(req, net, new Media { TmdbId = path[2] }).ConfigureAwait(false);
                return true;
            }
            if (path.Length == 7 && path[1] == "tv" && path[3] == "seasons" && path[5] == "episodes"
                && int.TryParse(path[4], NumberStyles.None, CultureInfo.InvariantCulture, out int season)
                && int.TryParse(path[6], NumberStyles.None, CultureInfo.InvariantCulture, out int episode))
            {
                await SourcesAsync(req, net, new Media { IsTv = true, TmdbId = path[2], Season = season, Episode = episode }).ConfigureAwait(false);
                return true;
            }
            if (path.Length == 2 && (path[1] == "proxy" || path[1] == "proxy.m3u8"))
            {
                await RelayAsync(req, net).ConfigureAwait(false);
                return true;
            }
            return false;
        }

        string Origin(HttpRequest req) => "http://" + (req.Header("Host") ?? "127.0.0.1");

        string Relayed(string origin, string id, string quality = null)
            => origin + "/v1/proxy?data=%40" + id + (quality != null ? "&quality=" + Uri.EscapeDataString(quality) : "");

        async Task SourcesAsync(HttpRequest req, Stream net, Media media)
        {
            if (media.TmdbId.Length == 0 || !media.TmdbId.All(char.IsDigit))
                throw new ServiceException(400, "invalid TMDB id");
            var sources = await finder.FindAsync(media, CancellationToken.None).ConfigureAwait(false);
            if (sources.Count == 0)
                throw new ServiceException(404, "no sources found");
            var origin = Origin(req);
            var sb = new StringBuilder("{\"sources\":[");
            for (int i = 0; i < sources.Count; i++)
            {
                var s = sources[i];
                if (i > 0) sb.Append(',');
                sb.Append(Json.Object().Add("url", Relayed(origin, links.Add(s.Url, s.Headers))).Add("type", s.Type).Add("quality", s.Quality)
                    .Raw("provider", Json.Object().Add("id", s.ProviderId).Add("name", s.ProviderName).ToString())
                    .Raw("subtitles", "[" + string.Join(",", s.Subtitles.Select(t => Json.Object().Add("url", Relayed(origin, links.Add(t.Url, s.Headers)))
                        .Add("label", t.Label).Add("language", t.Language).ToString())) + "]").ToString());
            }
            sb.Append("],\"subtitles\":[]}");
            await HttpService.SendAsync(net, 200, "application/json", sb.ToString()).ConfigureAwait(false);
        }

        Task RelayAsync(HttpRequest req, Stream net)
        {
            var data = req.QueryAll("data").FirstOrDefault() ?? "";
            return RelayLinkAsync(req, net, data.StartsWith("@", StringComparison.Ordinal) ? data.Substring(1) : null, null);
        }

        /// <summary>
        /// Relays link <paramref name="id"/>. <paramref name="refresh"/>, when given, is asked for a new link once if
        /// upstream refuses this one with 403/404/410 (a live stream's signed URL expired).
        /// </summary>
        public async Task RelayLinkAsync(HttpRequest req, Stream net, string id, Func<Task<string>> refresh)
        {
            var link = links.Get(id);
            if (link == null)
                throw new ServiceException(404, "expired proxy link");
            var quality = req.QueryAll("quality").FirstOrDefault();
            var range = req.Header("Range");
            bool head = req.Method == "HEAD";

            // Whole films (an mp4 source) and range requests pass through as they arrive; everything else
            // (playlists and segments) is read whole, so playlists can be rewritten and segments read ahead.
            if (range != null || IsFile(link.Url))
            {
                await PassThroughAsync(net, link, range, head).ConfigureAwait(false);
                return;
            }
            var fetched = await FromAheadAsync(link.Url).ConfigureAwait(false) ?? await Upstreaming(() => upstream.GetAsync(link.Url, link.Headers, CancellationToken.None)).ConfigureAwait(false);
            if (refresh != null && (fetched.Status == 403 || fetched.Status == 404 || fetched.Status == 410))
            {
                log.Add("relay " + Host(link.Url) + ": upstream " + fetched.Status + ", resolving again");
                link = links.Get(await refresh().ConfigureAwait(false));
                fetched = await Upstreaming(() => upstream.GetAsync(link.Url, link.Headers, CancellationToken.None)).ConfigureAwait(false);
            }
            StartAhead(link);
            if (fetched.Status < 200 || fetched.Status > 299)
            {
                log.Add("relay " + Host(link.Url) + ": upstream " + fetched.Status);
                throw new ServiceException(fetched.Status == 404 || fetched.Status == 403 || fetched.Status == 410 ? fetched.Status : 502, "upstream answered " + fetched.Status);
            }
            if (Hls.IsPlaylist(fetched.Body))
            {
                var origin = Origin(req);
                var segments = new List<string>();
                var idOf = new Dictionary<string, string>();
                var text = Hls.Rewrite(fetched.Text(), fetched.Url ?? link.Url, url =>
                {
                    var relayed = Relayed(origin, links.Add(url, link.Headers));
                    idOf[relayed] = relayed.Substring(relayed.IndexOf("%40", StringComparison.Ordinal) + 3);
                    return relayed;
                }, quality, segments);
                if (segments.Count > 0)
                {
                    // Only segment lines, not keys or init maps, are read ahead.
                    var segmentIds = segments.Select(u => idOf[u]).ToList();
                    links.SetPlaylist(segmentIds);
                    // A film starts at its first segments; a live stream at its newest.
                    bool live = !fetched.Text().Contains("#EXT-X-ENDLIST");
                    foreach (var next in live ? segmentIds.Skip(Math.Max(0, segmentIds.Count - 3)) : segmentIds.Take(3))
                        Prefetch(next);
                }
                var body = Encoding.UTF8.GetBytes(text);
                await HttpService.SendBytesAsync(net, 200, "application/vnd.apple.mpegurl", body, head).ConfigureAwait(false);
                return;
            }
            // Segments come labelled text/html (VidApi's page-N.html, VixSrc's AES-encrypted ones) but are MPEG-TS:
            // say so, or AVPlay won't play them. Keys and anything else keep their type.
            var body2 = link.Playlist != null ? Hls.UnwrapTs(fetched.Body) : fetched.Body;
            var type = link.Playlist != null || (body2.Length > 0 && body2[0] == 0x47) ? "video/mp2t"
                : fetched.ContentType.Length > 0 ? fetched.ContentType : "application/octet-stream";
            await HttpService.SendBytesAsync(net, 200, type, body2, head).ConfigureAwait(false);
        }

        static bool IsFile(string url)
        {
            var path = url.Split('?')[0].ToLowerInvariant();
            return path.EndsWith(".mp4") || path.EndsWith(".mkv") || path.EndsWith(".webm") || path.EndsWith(".avi") || path.EndsWith(".mov");
        }

        static string Host(string url)
        {
            try { return new Uri(url).Host; } catch { return "?"; }
        }

        async Task PassThroughAsync(Stream net, ProxyLinks.Link link, string range, bool head)
        {
            using (var response = await Upstreaming(() => upstream.SendAsync(link.Url, link.Headers, range, CancellationToken.None)).ConfigureAwait(false))
            {
                int status = (int)response.StatusCode;
                var headers = new StringBuilder();
                var content = response.Content.Headers;
                if (content.ContentRange != null)
                    headers.Append("Content-Range: ").Append(content.ContentRange).Append("\r\n");
                headers.Append("Accept-Ranges: bytes\r\n");
                var type = content.ContentType?.ToString() ?? "application/octet-stream";
                if (type.StartsWith("text/", StringComparison.OrdinalIgnoreCase) && IsFile(link.Url))
                    type = "video/mp4";
                var head1 = "HTTP/1.1 " + status + " " + HttpService.Reason(status) + "\r\nContent-Type: " + type + "\r\n" +
                    (content.ContentLength.HasValue ? "Content-Length: " + content.ContentLength.Value + "\r\n" : "") + headers +
                    "Access-Control-Allow-Origin: *\r\nAccess-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
                var bytes = Encoding.ASCII.GetBytes(head1);
                await net.WriteAsync(bytes, 0, bytes.Length).ConfigureAwait(false);
                if (head)
                    return;
                using (var body = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                    await body.CopyToAsync(net, 64 * 1024).ConfigureAwait(false);
            }
        }

        /// <summary>An upstream failure is the TV's answer (502, or 504 on a timeout), not a dropped connection.</summary>
        async Task<T> Upstreaming<T>(Func<Task<T>> call)
        {
            try { return await call().ConfigureAwait(false); }
            catch (TimeoutException e) { throw new ServiceException(504, e.Message); }
            catch (Exception e) when (e is HttpRequestException || e is InvalidDataException || e is IOException || e is OperationCanceledException)
            {
                throw new ServiceException(502, "upstream failed: " + e.GetBaseException().Message);
            }
        }

        void StartAhead(ProxyLinks.Link link)
        {
            if (link.Playlist == null)
                return;
            for (int i = 1; i <= ReadAhead && link.Index + i < link.Playlist.Length; i++)
                Prefetch(link.Playlist[link.Index + i]);
        }

        // Keyed by upstream URL: a live playlist reloaded every few seconds lists the same segments under new links.
        void Prefetch(string id)
        {
            var link = links.Get(id);
            if (link == null || IsFile(link.Url))
                return;
            lock (ahead)
            {
                var now = DateTime.UtcNow;
                foreach (var old in ahead.Where(kv => now - kv.Value.at > AheadExpiry).Select(kv => kv.Key).ToList())
                    ahead.Remove(old);
                if (ahead.ContainsKey(link.Url) || ahead.Count >= MaxAhead)
                    return;
                var task = upstream.GetAsync(link.Url, link.Headers, CancellationToken.None);
                task.ContinueWith(t => { var _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
                ahead[link.Url] = (task, now);
            }
        }

        /// <summary>A segment fetched ahead, waiting at most <see cref="AheadWait"/> for it; null to fetch it now.</summary>
        async Task<Fetched> FromAheadAsync(string url)
        {
            Task<Fetched> task;
            lock (ahead)
            {
                if (!ahead.TryGetValue(url, out var entry))
                    return null;
                ahead.Remove(url);
                task = entry.task;
            }
            if (await Task.WhenAny(task, Task.Delay(AheadWait)).ConfigureAwait(false) != task || task.IsFaulted || task.IsCanceled)
                return null;
            var fetched = task.Result;
            return fetched.Status >= 200 && fetched.Status <= 299 ? fetched : null;
        }
    }
}
