using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CouchTor.Streams;

namespace CouchTor.Sports
{
    /// <summary>One way to watch an item: a PPV stream (its embed page) of a match or channel.</summary>
    public sealed class Feed
    {
        public string Id, Embed, Label, Language;
    }

    public sealed class SportsItem
    {
        public string Id, Title, Kind, Sport, Thumb;
        public double StartsAt, EndsAt;
        public List<Feed> Feeds = new List<Feed>();
    }

    /// <summary>
    /// PPV's schedule (api.ppv.st/api/streams), as the app's /sports.json catalog: cricket and
    /// football only, events and always-on channels, each with its sources as feeds. Refreshed at most once a
    /// minute; the last good schedule is served, marked stale, for six hours.
    /// </summary>
    public sealed class SportsCatalog
    {
        /// <summary>PPV's API hosts, tried in order. (Streamed, the source before PPV, closed on 2026-11-04.)</summary>
        public static readonly string[] Hosts = { "https://api.ppv.st" };
        string host = Hosts[0];
        /// <summary>Association football; the household watches only these.</summary>
        public static readonly string[] Sports = { "Cricket", "Football" };

        readonly Upstream upstream;
        readonly LogRing log;
        readonly SemaphoreSlim gate = new SemaphoreSlim(1);
        readonly Func<DateTime> clock;
        List<SportsItem> items;
        Dictionary<string, Feed> feeds = new Dictionary<string, Feed>();
        DateTime updatedAt, attemptedAt;
        bool failed;

        public TimeSpan Refresh = TimeSpan.FromMinutes(1);
        /// <summary>After a failed load, the next request may try again this soon.</summary>
        public TimeSpan RetryFailed = TimeSpan.FromSeconds(10);
        public TimeSpan KeepStale = TimeSpan.FromHours(6);

        readonly SportsScores scores;

        public SportsCatalog(Upstream upstream, LogRing log, Func<DateTime> clock = null, SportsScores scores = null)
        {
            this.upstream = upstream;
            this.log = log;
            this.clock = clock ?? (() => DateTime.UtcNow);
            this.scores = scores;
        }

        static Dictionary<string, string> Headers() => new Dictionary<string, string> { ["User-Agent"] = PpvResolver.UserAgent, ["Accept"] = "application/json" };

        public static string SportName(string category)
        {
            var name = CultureInfo.InvariantCulture.TextInfo.ToTitleCase((category ?? "other").Replace('-', ' ').Trim().ToLowerInvariant());
            return name == "Soccer" ? "Football" : name == "Hockey" ? "Ice Hockey" : name;
        }

        public static string FeedId(string source, string match)
        {
            using (var sha = SHA256.Create())
                return "s-" + string.Concat(sha.ComputeHash(Encoding.UTF8.GetBytes(source + ":" + match)).Take(10).Select(b => b.ToString("x2")));
        }

        /// <summary>
        /// PPV's schedule as catalog items: {streams: [{category, streams: [{id, name, poster, starts_at, ends_at (s),
        /// always_live, locale, source_tag, iframe, substreams: [...]}]}]}. Each stream and substream (another
        /// quality or broadcaster) with an embed page is a feed.
        /// </summary>
        public static List<SportsItem> Normalize(object json)
        {
            if (!(JsonReader.Get(json, "streams") is List<object> categories))
                throw new InvalidDataException("invalid PPV schedule");
            var result = new List<SportsItem>();
            foreach (var category in categories.OfType<Dictionary<string, object>>())
            {
                var sport = SportName(JsonReader.Get(category, "category") as string);
                if (!Sports.Contains(sport))
                    continue;
                foreach (var entry in (JsonReader.Get(category, "streams") as List<object> ?? new List<object>()).OfType<Dictionary<string, object>>())
                {
                    var title = JsonReader.Get(entry, "name") as string;
                    if (!(JsonReader.Get(entry, "id") is double id) || string.IsNullOrEmpty(title))
                        continue;
                    bool channel = JsonReader.Get(entry, "always_live") is double live && live == 1 || JsonReader.Get(entry, "always_live") is bool on && on;
                    double start = JsonReader.Get(entry, "starts_at") is double s0 ? s0 : 0, end = JsonReader.Get(entry, "ends_at") is double e0 ? e0 : 0;
                    if (!channel && !(0 < start && start < end && end < 1e11))
                        continue;
                    var poster = JsonReader.Get(entry, "poster") as string ?? "";
                    var item = new SportsItem
                    {
                        Id = "ppv:" + id.ToString(CultureInfo.InvariantCulture), Title = title, Kind = channel ? "channel" : "event", Sport = sport,
                        StartsAt = channel ? 0 : start * 1000, EndsAt = channel ? 0 : end * 1000, Thumb = poster.StartsWith("https://") ? poster : "",
                    };
                    var subs = (JsonReader.Get(entry, "substreams") as List<object> ?? new List<object>()).OfType<Dictionary<string, object>>();
                    foreach (var s in new[] { entry }.Concat(subs))
                    {
                        var embed = JsonReader.Get(s, "iframe") as string ?? "";
                        if (!(JsonReader.Get(s, "id") is double feedId) || !embed.StartsWith("https://") || !embed.Contains("/embed/"))
                            continue;
                        var tag = JsonReader.Get(s, "source_tag") as string;
                        item.Feeds.Add(new Feed { Id = FeedId("ppv", feedId.ToString(CultureInfo.InvariantCulture)), Embed = embed,
                            Label = "PPV · " + (string.IsNullOrEmpty(tag) ? "Main" : tag), Language = Language(JsonReader.Get(s, "locale") as string) });
                    }
                    if (item.Feeds.Count > 0)
                        result.Add(item);
                }
            }
            return result;
        }

        async Task LoadAsync(CancellationToken token)
        {
            await gate.WaitAsync(token).ConfigureAwait(false);
            try
            {
                if (clock() - attemptedAt < (failed || items == null ? RetryFailed : Refresh))
                    return;
                attemptedAt = clock();
                try
                {
                    var (answer, working) = await FromAnyHostAsync("/api/streams", token).ConfigureAwait(false);
                    var fresh = Normalize(JsonReader.Parse(answer.Text()));
                    host = working;
                    var map = new Dictionary<string, Feed>(feeds);
                    foreach (var feed in fresh.SelectMany(i => i.Feeds))
                        map[feed.Id] = feed; // older feeds stay playable from a player that loaded them earlier
                    items = fresh;
                    feeds = map;
                    updatedAt = clock();
                    failed = false;
                }
                catch (Exception e) when (!token.IsCancellationRequested)
                {
                    failed = true;
                    log.Add("ppv schedule failed: " + e.GetBaseException().Message);
                }
            }
            finally { gate.Release(); }
        }

        /// <summary>The first host that answers 200, starting with the one that worked last.</summary>
        async Task<(Fetched answer, string host)> FromAnyHostAsync(string path, CancellationToken token)
        {
            var errors = new List<string>();
            foreach (var candidate in new[] { host }.Concat(Hosts.Where(h => h != host)))
            {
                try
                {
                    var answer = await upstream.GetAsync(candidate + path, Headers(), token).ConfigureAwait(false);
                    if (answer.Status == 200)
                        return (answer, candidate);
                    errors.Add(new Uri(candidate).Host + ": HTTP " + answer.Status);
                }
                catch (Exception e) when (!token.IsCancellationRequested)
                {
                    errors.Add(new Uri(candidate).Host + ": " + e.GetBaseException().GetType().Name + " " + e.GetBaseException().Message);
                }
            }
            throw new InvalidDataException(string.Join("; ", errors));
        }

        /// <summary>Loads the schedule ahead of the first request (at service start).</summary>
        public Task WarmAsync() => LoadAsync(CancellationToken.None);

        public async Task<Feed> FeedAsync(string id, CancellationToken token)
        {
            if (!feeds.ContainsKey(id))
                await LoadAsync(token).ConfigureAwait(false);
            return feeds.TryGetValue(id, out var feed) ? feed : null;
        }

        /// <summary>For /sports/health: "ok", "stale" (the last load failed) or "none" (never loaded), and when it last loaded.</summary>
        public (string status, DateTime updatedAt) Status => (items == null ? "none" : failed ? "stale" : "ok", updatedAt);

        /// <summary>A feed to test the resolver with: a 24/7 channel (always on air), else an event that started in the last two hours.</summary>
        public async Task<SportsItem> TestItemAsync(CancellationToken token)
        {
            await LoadAsync(token).ConfigureAwait(false);
            var now = new DateTimeOffset(clock()).ToUnixTimeMilliseconds();
            return (items ?? new List<SportsItem>()).OrderBy(i => i.Kind == "channel" ? 0 : 1)
                .FirstOrDefault(i => i.Kind == "channel" || (i.StartsAt <= now && now - i.StartsAt < 2 * 3600000));
        }

        /// <summary>The /sports.json body, with play URLs under <paramref name="origin"/>.</summary>
        public async Task<string> JsonAsync(string origin, CancellationToken token)
        {
            await LoadAsync(token).ConfigureAwait(false);
            bool usable = items != null && clock() - updatedAt <= KeepStale;
            if (!usable)
                throw new ServiceException(503, "sports schedules unavailable");
            var sb = new StringBuilder("{\"items\":[");
            bool first = true;
            var games = scores?.Games();
            foreach (var item in items)
            {
                var game = games != null && item.Kind == "event" ? SportsScores.Match(item.Title, item.StartsAt, games) : null;
                var score = game?.Score;
                if (!first) sb.Append(',');
                first = false;
                var streams = string.Join(",", item.Feeds.Select(f => Json.Object().Add("id", f.Id).Add("url", origin + "/sports/play/" + f.Id + ".m3u8")
                    .Add("label", f.Label).Add("language", f.Language).ToString()));
                sb.Append(Json.Object().Add("id", item.Id).Add("title", item.Title).Add("kind", item.Kind).Add("sport", item.Sport)
                    .Add("thumb", item.Thumb).Add("startsAt", item.StartsAt).Add("endsAt", item.EndsAt).Raw("streams", "[" + streams + "]")
                    .Raw("score", score != null ? SportsScores.ToJson(score) : "null")
                    .Raw("espn", game != null && game.Event.Length > 0 && game.League.Length > 0 ? SportsScores.RefJson(game) : "null").ToString());
            }
            var provider = Json.Object().Add("name", "PPV").Add("status", failed ? "stale" : "ok")
                .Add("updatedAt", (double)new DateTimeOffset(updatedAt).ToUnixTimeMilliseconds()).ToString();
            return sb.Append("],\"providers\":[").Append(provider).Append("]}").ToString();
        }

        public static string Language(string value)
        {
            var name = (value ?? "").Trim().ToLowerInvariant().Replace('_', '-').Split('-')[0];
            switch (name)
            {
                case "english": case "eng": return "en";
                case "hindi": case "hin": return "hi";
                case "nepali": case "nep": return "ne";
                case "main": return "";
                default: return name;
            }
        }
    }
}
