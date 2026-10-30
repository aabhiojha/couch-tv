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
    /// <summary>One way to watch an item: a Streamed source of a match or channel.</summary>
    public sealed class Feed
    {
        public string Id, Source, Match, Label;
    }

    public sealed class SportsItem
    {
        public string Id, Title, Kind, Sport, Thumb;
        public double StartsAt;
        public List<Feed> Feeds = new List<Feed>();
    }

    /// <summary>
    /// Streamed's schedule (/api/matches/all), as the app's /sports.json catalog: cricket and
    /// football only, events and always-on channels, each with its sources as feeds. Refreshed at most once a
    /// minute; the last good schedule is served, marked stale, for six hours.
    /// </summary>
    public sealed class SportsCatalog
    {
        /// <summary>
        /// Streamed's mirrors, tried in order. The home router's DNS blocks streamed.pk (it answers 127.0.0.1) and
        /// streamed.su; streamed.st serves the same API.
        /// </summary>
        public static readonly string[] Hosts = { "https://streamed.st", "https://streamed.pk" };
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

        static Dictionary<string, string> Headers() => new Dictionary<string, string> { ["User-Agent"] = StreamedResolver.UserAgent, ["Accept"] = "application/json" };

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

        /// <summary>Streamed's match list as catalog items (no positive date = an always-on channel).</summary>
        public static List<SportsItem> Normalize(object json, string streamed)
        {
            if (!(json is List<object> list))
                throw new InvalidDataException("invalid Streamed schedule");
            var result = new List<SportsItem>();
            foreach (var entry in list.OfType<Dictionary<string, object>>())
            {
                var id = JsonReader.Get(entry, "id") as string;
                var title = JsonReader.Get(entry, "title") as string;
                var sport = SportName(JsonReader.Get(entry, "category") as string);
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(title) || !Sports.Contains(sport))
                    continue;
                // Channels carry no start: Streamed has used 0 and, since October 2026, -3600000.
                double start = JsonReader.Get(entry, "date") is double d && d > 0 ? d : 0;
                if (start >= 1e14)
                    continue;
                var item = new SportsItem { Id = "streamed:" + id, Title = title, Kind = start > 0 ? "event" : "channel", Sport = sport, StartsAt = start };
                var poster = JsonReader.Get(entry, "poster") as string ?? "";
                item.Thumb = poster.StartsWith("/") ? streamed + poster : poster.StartsWith("https://") ? poster : "";
                foreach (var s in (JsonReader.Get(entry, "sources") as List<object> ?? new List<object>()).OfType<Dictionary<string, object>>())
                {
                    var source = JsonReader.Get(s, "source") as string;
                    var match = JsonReader.Get(s, "id") as string;
                    if (string.IsNullOrEmpty(source) || string.IsNullOrEmpty(match))
                        continue;
                    item.Feeds.Add(new Feed { Id = FeedId(source, match), Source = source, Match = match,
                        Label = "Streamed · " + CultureInfo.InvariantCulture.TextInfo.ToTitleCase(source) });
                }
                if (item.Feeds.Count > 0)
                    result.Add(item);
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
                    var (answer, working) = await FromAnyHostAsync("/api/matches/all", token).ConfigureAwait(false);
                    var fresh = Normalize(JsonReader.Parse(answer.Text()), working);
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
                    log.Add("streamed schedule failed: " + e.GetBaseException().Message);
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
                var score = games != null && item.Kind == "event" ? SportsScores.Match(item.Title, item.StartsAt, games) : null;
                if (!first) sb.Append(',');
                first = false;
                var streams = string.Join(",", item.Feeds.Select(f => Json.Object().Add("id", f.Id).Add("url", origin + "/sports/play/" + f.Id + ".m3u8")
                    .Add("label", f.Label).Add("language", "").ToString()));
                sb.Append(Json.Object().Add("id", item.Id).Add("title", item.Title).Add("kind", item.Kind).Add("sport", item.Sport)
                    .Add("thumb", item.Thumb).Add("startsAt", item.StartsAt).Add("endsAt", 0L).Raw("streams", "[" + streams + "]")
                    .Raw("score", score != null ? SportsScores.ToJson(score) : "null").ToString());
            }
            var provider = Json.Object().Add("name", "Streamed").Add("status", failed ? "stale" : "ok")
                .Add("updatedAt", (double)new DateTimeOffset(updatedAt).ToUnixTimeMilliseconds()).ToString();
            return sb.Append("],\"providers\":[").Append(provider).Append("]}").ToString();
        }

        /// <summary>
        /// The stream to resolve for a feed: Streamed lists one or more streams per source, each with an embed URL
        /// (…/embed/{source}/{id}/{streamNo}) and a language. English, Hindi or Nepali commentary is preferred,
        /// then unlabelled, then anything.
        /// </summary>
        public async Task<(string source, string id, string streamNo)> StreamAsync(Feed feed, CancellationToken token)
        {
            Fetched answer;
            try { answer = (await FromAnyHostAsync("/api/stream/" + Uri.EscapeDataString(feed.Source) + "/" + Uri.EscapeDataString(feed.Match), token).ConfigureAwait(false)).answer; }
            catch (Exception e) when (!(e is OperationCanceledException)) { throw new ServiceException(502, "Streamed stream list: " + e.GetBaseException().Message); }
            var choices = (JsonReader.Parse(answer.Text()) as List<object> ?? new List<object>()).OfType<Dictionary<string, object>>()
                .Select(c => (embed: JsonReader.Get(c, "embedUrl") as string ?? "", language: Language(JsonReader.Get(c, "language") as string)))
                .Where(c => c.embed.Contains("/embed/")).ToList();
            if (choices.Count == 0)
                throw new ServiceException(404, "no stream listed for this source");
            var order = new[] { "en", "hi", "ne", "" };
            var best = choices.OrderBy(c => Array.IndexOf(order, c.language) is int i && i >= 0 ? i : order.Length).First();
            var parts = new Uri(best.embed).AbsolutePath.Split('/');
            int at = Array.IndexOf(parts, "embed");
            if (at < 0 || parts.Length < at + 4)
                throw new ServiceException(502, "unexpected embed URL");
            return (Uri.UnescapeDataString(parts[at + 1]), Uri.UnescapeDataString(parts[at + 2]), Uri.UnescapeDataString(parts[at + 3]));
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
