using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using CouchTor.Streams;

namespace CouchTor.Sports
{
    /// <summary>
    /// <c>/sports/board?sport=soccer|cricket&amp;date=YYYYMMDD</c>: ESPN's scoreboard for a day, as the Sports guide reads it,
    /// cut to the fields the app uses. A football day is ~1 MB from ESPN (links, odds and broadcasts on every game)
    /// and parsing it on the app's UI thread cost the TV 60 ms a board; trimmed here, off that thread, it is ~5%
    /// of that. Boards are kept for a minute, so the app's refreshes and adjacent days share a fetch.
    /// </summary>
    public sealed class SportsBoards : IHttpRoutes
    {
        const string Board = "https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=";
        static readonly Regex Day = new Regex(@"^\d{8}$");
        // Every key the app's Espn.parseBoard reads, at any depth; everything else is dropped.
        static readonly HashSet<string> Keep = new HashSet<string>(StringComparer.Ordinal)
        {
            "sports", "leagues", "events", "id", "slug", "name", "abbreviation", "status", "date", "title", "location",
            "broadcast", "summary", "fullStatus", "displayClock", "type", "completed", "description", "shortDetail",
            "competitors", "homeAway", "displayName", "score", "winner", "order", "logo", "logoDark",
        };

        readonly Upstream upstream;
        readonly LogRing log;
        readonly Func<DateTime> clock;
        readonly Dictionary<string, (DateTime at, Task<string> json)> cache = new Dictionary<string, (DateTime, Task<string>)>();
        public TimeSpan Fresh = TimeSpan.FromMinutes(1);

        public SportsBoards(Upstream upstream, LogRing log, Func<DateTime> clock = null)
        {
            this.upstream = upstream;
            this.log = log;
            this.clock = clock ?? (() => DateTime.UtcNow);
        }

        public async Task<bool> TryHandleAsync(HttpRequest req, string[] path, Stream net)
        {
            if (path.Length != 2 || path[0] != "sports" || path[1] != "board")
                return false;
            var sport = req.QueryAll("sport").FirstOrDefault();
            var date = req.QueryAll("date").FirstOrDefault() ?? "";
            if ((sport != "soccer" && sport != "cricket") || !Day.IsMatch(date))
                throw new ServiceException(400, "sport=soccer|cricket and date=YYYYMMDD are required");
            string json;
            try { json = await BoardAsync(sport, date).ConfigureAwait(false); }
            catch (Exception e) when (!(e is ServiceException))
            {
                log.Add("board " + sport + " " + date + ": " + e.GetBaseException().Message);
                throw new ServiceException(502, "ESPN didn't answer: " + e.GetBaseException().Message);
            }
            await HttpService.SendAsync(net, 200, "application/json", json).ConfigureAwait(false);
            return true;
        }

        Task<string> BoardAsync(string sport, string date)
        {
            var key = sport + ":" + date;
            lock (cache)
            {
                if (cache.TryGetValue(key, out var hit) && clock() - hit.at < Fresh && !hit.json.IsFaulted)
                    return hit.json;
                // A board in flight is shared; old ones go once there are more than a fortnight's worth.
                if (cache.Count > 28)
                    foreach (var old in cache.Where(c => clock() - c.Value.at >= Fresh).Select(c => c.Key).ToList())
                        cache.Remove(old);
                var task = FetchAsync(sport, date);
                cache[key] = (clock(), task);
                return task;
            }
        }

        async Task<string> FetchAsync(string sport, string date)
        {
            var answer = await upstream.GetAsync(Board + sport + "&dates=" + date, new Dictionary<string, string> { ["Accept"] = "application/json" },
                CancellationToken.None).ConfigureAwait(false);
            if (answer.Status != 200)
                throw new IOException("HTTP " + answer.Status);
            return Trim(JsonReader.Parse(answer.Text()));
        }

        /// <summary>The same JSON with only <see cref="Keep"/> keys left in its objects.</summary>
        public static string Trim(object json)
        {
            var sb = new StringBuilder();
            Write(sb, json);
            return sb.ToString();
        }

        static void Write(StringBuilder sb, object v)
        {
            switch (v)
            {
                case null: sb.Append("null"); break;
                case string s: Json.Str(sb, s); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case double d: sb.Append(d.ToString("R", CultureInfo.InvariantCulture)); break;
                case List<object> list:
                    sb.Append('[');
                    for (var i = 0; i < list.Count; i++)
                    {
                        if (i > 0) sb.Append(',');
                        Write(sb, list[i]);
                    }
                    sb.Append(']');
                    break;
                case Dictionary<string, object> map:
                    sb.Append('{');
                    var first = true;
                    foreach (var kv in map)
                    {
                        if (!Keep.Contains(kv.Key)) continue;
                        if (!first) sb.Append(',');
                        first = false;
                        Json.Str(sb, kv.Key);
                        sb.Append(':');
                        Write(sb, kv.Value);
                    }
                    sb.Append('}');
                    break;
                default: Json.Str(sb, Convert.ToString(v, CultureInfo.InvariantCulture)); break;
            }
        }
    }
}
