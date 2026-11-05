using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace CouchTor.Streams
{
    /// <summary>
    /// vixsrc.to, ported from CinePro Core's VixSrc provider: its API names an embed page, whose script carries the
    /// master playlist URL and a token. Usually 1080p.
    /// </summary>
    public sealed class VixSrc : IStreamProvider
    {
        const string Base = "https://vixsrc.to";
        static readonly Regex Token = new Regex("token[\"']\\s*:\\s*[\"']([^\"']+)");
        static readonly Regex Expires = new Regex("expires[\"']\\s*:\\s*[\"']([^\"']+)");
        static readonly Regex PlaylistUrl = new Regex("url\\s*:\\s*[\"']([^\"']+)");
        static readonly Regex Height = new Regex(@"#EXT-X-STREAM-INF:[^\n]*RESOLUTION=\d+x(\d+)");

        readonly Upstream upstream;
        readonly Func<DateTime> clock;

        public string Id => "vixsrc";
        public string Name => "VixSrc";

        public VixSrc(Upstream upstream, Func<DateTime> clock = null)
        {
            this.upstream = upstream;
            this.clock = clock ?? (() => DateTime.UtcNow);
        }

        static Dictionary<string, string> Headers(string referer) => new Dictionary<string, string>
        {
            ["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36",
            ["Accept"] = "application/json, text/javascript, */*; q=0.01",
            ["Accept-Language"] = "en-US,en;q=0.9",
            ["Referer"] = referer,
            ["Origin"] = Base,
        };

        public async Task<IReadOnlyList<Source>> FindAsync(Media media, CancellationToken token)
        {
            var none = new Source[0];
            var pageUrl = media.IsTv
                ? Base + "/api/tv/" + Uri.EscapeDataString(media.TmdbId) + "/" + media.Season + "/" + media.Episode
                : Base + "/api/movie/" + Uri.EscapeDataString(media.TmdbId);
            var api = await upstream.GetAsync(pageUrl, Headers(Base), token).ConfigureAwait(false);
            if (api.Status != 200)
                return none;
            var embed = JsonReader.Str(JsonReader.Parse(api.Text()), "src");
            if (string.IsNullOrEmpty(embed))
                return none;
            var page = await upstream.GetAsync(Base + embed, Headers(Base), token).ConfigureAwait(false);
            if (page.Status != 200)
                return none;
            var html = page.Text();
            var tokenValue = Token.Match(html).Groups[1].Value;
            var expires = Expires.Match(html).Groups[1].Value;
            var playlist = PlaylistUrl.Match(html).Groups[1].Value;
            if (tokenValue.Length == 0 || playlist.Length == 0 || !long.TryParse(expires, NumberStyles.Integer, CultureInfo.InvariantCulture, out long expiry))
                return none;
            if (DateTimeOffset.FromUnixTimeSeconds(expiry).UtcDateTime.AddMinutes(-1) < clock())
                return none;
            var master = playlist + (playlist.Contains("?") ? "&" : "?") + "token=" + tokenValue + "&expires=" + expires + "&h=1";
            var headers = Headers(pageUrl);
            var renditions = await upstream.GetAsync(master, headers, token).ConfigureAwait(false);
            if (renditions.Status != 200)
                return none;
            var text = renditions.Text();
            var heights = Height.Matches(text.Replace("\r\n", "\n")).Cast<Match>().Select(m => int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture)).ToList();
            if (heights.Count == 0)
                return none;
            return new[] { new Source { Url = master, Type = "hls", Quality = heights.Max() + "p", Headers = headers, ProviderId = Id, ProviderName = Name,
                Subtitles = Hls.Subtitles(text, renditions.Url ?? master) } };
        }
    }

    /// <summary>
    /// VidApi (vaplayer.ru), ported from CinePro Core's VidApi provider: one API call lists the stream URLs, which
    /// play with the player page's Referer (its segment host wants none: see <see cref="Upstream.SendAsync"/>).
    /// </summary>
    public sealed class VidApi : IStreamProvider
    {
        const string Api = "https://streamdata.vaplayer.ru/api.php";
        const string Player = "https://brightpathsignals.com";
        static readonly Random Random = new Random();

        readonly Upstream upstream;

        public string Id => "vidapi";
        public string Name => "VidApi";

        public VidApi(Upstream upstream) { this.upstream = upstream; }

        public async Task<IReadOnlyList<Source>> FindAsync(Media media, CancellationToken token)
        {
            var url = Api + "?tmdb=" + Uri.EscapeDataString(media.TmdbId) + "&type=" + (media.IsTv ? "tv" : "movie");
            if (media.IsTv)
                url += "&season=" + media.Season + "&episode=" + media.Episode;
            var headers = new Dictionary<string, string>
            {
                ["User-Agent"] = UserAgent(),
                ["Referer"] = Player + "/",
                ["Origin"] = Player,
                ["Accept"] = "*/*",
            };
            var answer = await upstream.GetAsync(url, headers, token).ConfigureAwait(false);
            if (answer.Status != 200)
                return new Source[0];
            var json = JsonReader.Parse(answer.Text());
            if (JsonReader.Str(json, "status_code") != "200" || !(JsonReader.Get(json, "data", "stream_urls") is List<object> urls))
                return new Source[0];
            var quality = InferQuality(JsonReader.Str(json, "data", "file_name"));
            return urls.OfType<string>().Where(u => u.StartsWith("http", StringComparison.OrdinalIgnoreCase)).Select(u => new Source
            {
                Url = u,
                Type = u.Contains("mp4") || u.Contains("mkv") ? "mp4" : "hls",
                Quality = quality,
                Headers = headers,
                ProviderId = Id,
                ProviderName = Name,
            }).ToList();
        }

        public static string InferQuality(string fileName)
        {
            var m = Regex.Match(fileName ?? "", @"(2160|1440|1080|720|576|480|360)p", RegexOptions.IgnoreCase);
            if (m.Success)
                return m.Groups[1].Value + "p";
            return Regex.IsMatch(fileName ?? "", @"\b(4k|uhd)\b", RegexOptions.IgnoreCase) ? "2160p" : "unknown";
        }

        /// <summary>A plausible desktop or Android browser, different per lookup (as CinePro does).</summary>
        static string UserAgent()
        {
            int r;
            lock (Random)
                r = Random.Next(1000000);
            string chrome = (110 + r % 17) + ".0." + (1000 + r % 9000) + "." + (r % 100);
            switch (r % 3)
            {
                case 0: return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + chrome + " Safari/537.36";
                case 1: return "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + chrome + " Safari/537.36";
                default: return "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + chrome + " Mobile Safari/537.36";
            }
        }
    }
}
