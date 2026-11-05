using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using CouchTor.Streams;

namespace CouchTor.Sports
{
    /// <summary>A game's score as the Sports screen shows it: "in" (live) or "post", a one-line score, crests.</summary>
    public sealed class Score
    {
        public string State, Line, Summary;
        public string[] Crests;
    }

    /// <summary>
    /// Live scores from ESPN's public scoreboards (cricket and football; no key). They're fetched in the background
    /// at most once a minute, so the listing never waits on ESPN; the football one is ~550 KB, too much to parse on
    /// the TV's UI thread. A listing gets the score of the game whose two teams both appear in its title and that
    /// starts within 18 hours of it; exact names beat partial ones, so "India vs Australia" never takes "India A".
    /// </summary>
    public sealed class SportsScores
    {
        const string Board = "https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=";
        static readonly Regex Versus = new Regex(@"\s+(?:vs?\.?|v)\s+", RegexOptions.IgnoreCase);
        static readonly Regex Noise = new Regex(@"\([^)]*\)|\b(?:fc|cf|afc|sc|club|the)\b|[^a-z0-9]+");

        public sealed class Game
        {
            public string[] Names;
            public double Start;
            /// <summary>Null until the game starts.</summary>
            public Score Score;
            /// <summary>ESPN's sport ("soccer" or "cricket"), league slug and event id: the app's match page reads ESPN with these.</summary>
            public string Sport, League, Event;
        }

        readonly Upstream upstream;
        readonly LogRing log;
        readonly Func<DateTime> clock;
        List<Game> games = new List<Game>();
        DateTime fetchedAt = DateTime.MinValue;
        int refreshing;
        public TimeSpan Refresh = TimeSpan.FromMinutes(1);

        public SportsScores(Upstream upstream, LogRing log, Func<DateTime> clock = null)
        {
            this.upstream = upstream;
            this.log = log;
            this.clock = clock ?? (() => DateTime.UtcNow);
        }

        /// <summary>The games known now; starts a background refresh when they're older than <see cref="Refresh"/>.</summary>
        public List<Game> Games()
        {
            if (clock() - fetchedAt > Refresh && Interlocked.Exchange(ref refreshing, 1) == 0)
                _ = RefreshAsync();
            return games;
        }

        /// <summary>Fetches both boards now (also what <see cref="Games"/> runs in the background).</summary>
        public async Task RefreshAsync()
        {
            try
            {
                var all = new List<Game>();
                foreach (var sport in new[] { "cricket", "soccer" })
                {
                    var answer = await upstream.GetAsync(Board + sport, new Dictionary<string, string> { ["Accept"] = "application/json" }, CancellationToken.None).ConfigureAwait(false);
                    if (answer.Status == 200)
                        all.AddRange(Parse(JsonReader.Parse(answer.Text()), sport == "soccer"));
                }
                games = all;
            }
            catch (Exception e)
            {
                log.Add("scores: " + e.GetBaseException().Message);
            }
            finally
            {
                fetchedAt = clock();
                refreshing = 0;
            }
        }

        public static string Normal(string name) => Noise.Replace((name ?? "").ToLowerInvariant(), " ").Trim();

        /// <summary>Upcoming, live and finished games from one board (only live and finished ones have a score).</summary>
        public static List<Game> Parse(object json, bool football)
        {
            var result = new List<Game>();
            var leagues = (JsonReader.Get(json, "sports") as List<object> ?? new List<object>()).SelectMany(s => JsonReader.Get(s, "leagues") as List<object> ?? new List<object>());
            foreach (var (league, e) in leagues.SelectMany(l => (JsonReader.Get(l, "events") as List<object> ?? new List<object>()).Select(e => (l, e))))
            {
                var state = JsonReader.Str(e, "status");
                var teams = (JsonReader.Get(e, "competitors") as List<object> ?? new List<object>()).OfType<Dictionary<string, object>>().ToList();
                if ((state != "pre" && state != "in" && state != "post") || teams.Count != 2)
                    continue;
                string S(object o, string key) => JsonReader.Str(o, key) ?? "";
                string line;
                if (football)
                {
                    var home = teams.FirstOrDefault(t => S(t, "homeAway") == "home") ?? teams[0];
                    var away = teams.First(t => t != home);
                    var clockText = state == "post" ? S(JsonReader.Get(e, "fullStatus", "type"), "shortDetail") : S(JsonReader.Get(e, "fullStatus"), "displayClock");
                    line = S(home, "abbreviation") + " " + S(home, "score") + " – " + S(away, "score") + " " + S(away, "abbreviation") + (clockText.Length > 0 ? " · " + clockText : "");
                }
                else
                {
                    line = string.Join(" · ", teams.OrderBy(t => JsonReader.Get(t, "order") is double o ? o : 0)
                        .Where(t => S(t, "score").Length > 0).Select(t => S(t, "abbreviation") + " " + S(t, "score")));
                }
                DateTimeOffset.TryParse(S(e, "date"), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var start);
                result.Add(new Game
                {
                    Names = teams.Select(t => Normal(S(t, "displayName"))).ToArray(),
                    Start = start.ToUnixTimeMilliseconds(),
                    Score = state == "pre" ? null : new Score { State = state, Line = line, Summary = S(JsonReader.Get(e, "fullStatus"), "summary"), Crests = teams.Select(t => S(t, "logo")).ToArray() },
                    Sport = football ? "soccer" : "cricket", League = S(league, "slug"), Event = S(e, "id"),
                });
            }
            return result;
        }

        /// <summary>The game for a listing titled "A vs B" starting at <paramref name="startsAt"/> (ms), or null.</summary>
        public static Game Match(string title, double startsAt, IEnumerable<Game> games)
        {
            var sides = Versus.Split(title ?? "");
            if (sides.Length != 2)
                return null;
            string a = Normal(sides[0]), b = Normal(sides[1]);
            int Fit(string side, string team) => team.Length < 3 || side.Length < 3 ? 0 : side == team ? 3 : side.StartsWith(team + " ") || side.EndsWith(" " + team) ? 2 : side.Contains(team) || team.Contains(side) ? 1 : 0;
            Game best = null;
            int bestFit = 0;
            foreach (var g in games)
            {
                if (startsAt > 0 && Math.Abs(g.Start - startsAt) > 18 * 3600000)
                    continue;
                int straight = Fit(a, g.Names[0]) * Fit(b, g.Names[1]), crossed = Fit(a, g.Names[1]) * Fit(b, g.Names[0]);
                int fit = Math.Max(straight, crossed);
                if (fit > bestFit)
                {
                    bestFit = fit;
                    best = g;
                }
            }
            return best;
        }

        /// <summary>The listing's "espn" field: where the app reads the match's details.</summary>
        public static string RefJson(Game g) => Json.Object().Add("sport", g.Sport).Add("league", g.League).Add("event", g.Event).ToString();

        public static string ToJson(Score s) => Json.Object().Add("state", s.State).Add("line", s.Line).Add("summary", s.Summary)
            .Raw("crests", "[" + string.Join(",", s.Crests.Select(c => { var sb = new System.Text.StringBuilder(); Json.Str(sb, c); return sb.ToString(); })) + "]").ToString();
    }
}
