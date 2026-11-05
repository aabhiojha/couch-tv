using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CouchTor;
using CouchTor.Sports;
using CouchTor.Streams;
using Wacs.Core.Runtime;
using Xunit;

public class WasmHostTests
{
    // A wasm-bindgen-shaped module (tests/…/reentry.wat in the commit message's terms): an externref table, an
    // allocator, a no-argument import whose result the module reads back from the table, and check() -> (i32, i32).
    static readonly byte[] Module = Convert.FromBase64String("AGFzbQEAAAABGAVgAAF/YAAAYAFvAX9gAn9/AX9gAAJ/fwKJAQMJLi90X2JnLmpzK19fd2JnX3N0YXRpY19hY2Nlc3Nvcl9TRUxGXzAxMjM0NTY3ODlhYmNkZWYAAAkuL3RfYmcuanMfX193YmluZGdlbl9pbml0X2V4dGVybnJlZl90YWJsZQABCS4vdF9iZy5qcxdfX3diaW5kZ2VuX2lzX3VuZGVmaW5lZAACAwUEAAMBBAQEAW8ABAUDAQABBgYBfwFBAAsHawYVX193YmluZGdlbl9leHRlcm5yZWZzAQAGbWVtb3J5AgAXX19leHRlcm5yZWZfdGFibGVfYWxsb2MAAxFfX3diaW5kZ2VuX21hbGxvYwAEEF9fd2JpbmRnZW5fc3RhcnQABQVjaGVjawAGCjcEDwEBf9BvQQH8DwAhACAACxUBAX8jAEGACGohAiMAIABqJAAgAgsEABABCwoAEAAlABACQQcL");

    [Fact]
    public void ReadsImportsAndExportsWithSignatures()
    {
        var (imports, exports) = WasmBinary.Functions(Module);
        Assert.Equal(new[] { "__wbg_static_accessor_SELF_0123456789abcdef", "__wbindgen_init_externref_table", "__wbindgen_is_undefined" }, imports.Select(i => i.Name));
        Assert.Equal("(externref)->(i32)", imports[2].Signature);
        Assert.Equal("()->(i32,i32)", exports.Single(e => e.Name == "check").Signature);
        Assert.Throws<InvalidDataException>(() => WasmBinary.Functions(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 }));
    }

    [Fact]
    public void AnImportCanCallBackIntoTheModule()
    {
        // static_accessor_SELF allocates a table slot by calling the module while the module's operand stack is
        // empty: WACS would treat that as a top-level call and never return to check() without the host's fix.
        var host = new JsHost(Module, "embed.st", "UA", (r, t) => Task.FromResult(new JsResponse()));
        host.Export("__wbindgen_start")(new Value[0]);
        var result = host.Export("check")(new Value[0]);
        Assert.Equal(0, result[0].Data.Int32); // window, not undefined
        Assert.Equal(7, result[1].Data.Int32); // and check() ran to its end
    }

    [Fact]
    public void PromisesSettleThroughMicrotasks()
    {
        var host = new JsHost(Module, "embed.st", "UA", (r, t) => Task.FromResult(new JsResponse()));
        var p = new JsPromise(host);
        var seen = new List<object>();
        p.Then(new JsFunction("ok", a => { seen.Add(a[0]); return "next"; }), null)
            .Then(new JsFunction("ok2", a => { seen.Add(a[0]); return null; }), null);
        p.Resolve(5.0);
        host.Run(() => { }, () => seen.Count == 2, TimeSpan.FromSeconds(1), CancellationToken.None);
        Assert.Equal(new object[] { 5.0, "next" }, seen);
    }
}

public class SportsCatalogTests
{
    // PPV's /api/streams, trimmed to what SportsCatalog reads.
    const string Schedule = "{\"success\":true,\"streams\":[" +
        "{\"category\":\"Cricket\",\"streams\":[{\"id\":27493,\"name\":\"Willow\",\"always_live\":1,\"starts_at\":-3600,\"ends_at\":10800,\"locale\":\"en\"," +
            "\"source_tag\":\"HD | Willow\",\"poster\":\"https://static.example/w.jpg\",\"iframe\":\"https://embed.example/embed/247-willow\"," +
            "\"substreams\":[{\"id\":1027493,\"source_tag\":\"SD | Willow\",\"locale\":\"en\",\"iframe\":\"https://embed.example/embed/247-willow_540p\"}]}]}," +
        "{\"category\":\"Football\",\"streams\":[{\"id\":31615,\"name\":\"Fenerbahce vs. Liverpool\",\"always_live\":0,\"starts_at\":1793050000,\"ends_at\":1793059000," +
            "\"locale\":\"en-gb\",\"source_tag\":\"HD | TNT Sports 1\",\"iframe\":\"https://embed.example/embed/ucl/2026-11-04/fen-liv\"}," +
            "{\"id\":31616,\"name\":\"No embed\",\"always_live\":0,\"starts_at\":1793050000,\"ends_at\":1793059000,\"iframe\":\"\"}," +
            "{\"id\":31617,\"name\":\"Bad times\",\"always_live\":0,\"starts_at\":0,\"ends_at\":0,\"iframe\":\"https://embed.example/embed/x\"}]}," +
        "{\"category\":\"American Football\",\"streams\":[{\"id\":1,\"name\":\"Jets vs Giants\",\"always_live\":0,\"starts_at\":1793050000,\"ends_at\":1793059000,\"iframe\":\"https://embed.example/embed/nfl\"}]}]}";

    [Fact]
    public void KeepsCricketAndFootballWithTheirFeeds()
    {
        var items = SportsCatalog.Normalize(JsonReader.Parse(Schedule));
        Assert.Equal(new[] { "Willow", "Fenerbahce vs. Liverpool" }, items.Select(i => i.Title));
        Assert.Equal("channel", items[0].Kind);
        Assert.Equal(0, items[0].StartsAt);
        Assert.Equal("https://static.example/w.jpg", items[0].Thumb);
        Assert.Equal(new[] { "PPV · HD | Willow", "PPV · SD | Willow" }, items[0].Feeds.Select(f => f.Label)); // substreams are feeds too
        Assert.Equal("event", items[1].Kind);
        Assert.Equal(1793050000000, items[1].StartsAt); // seconds to milliseconds
        Assert.Equal(1793059000000, items[1].EndsAt);
        Assert.Equal("en", items[1].Feeds[0].Language); // en-gb
        Assert.Equal("https://embed.example/embed/ucl/2026-11-04/fen-liv", items[1].Feeds[0].Embed);
        Assert.Equal(SportsCatalog.FeedId("ppv", "31615"), items[1].Feeds[0].Id);
        Assert.Matches("^s-[0-9a-f]{20}$", items[1].Feeds[0].Id);
        Assert.Throws<InvalidDataException>(() => SportsCatalog.Normalize(JsonReader.Parse("[]")));
        Assert.Equal("", SportsCatalog.Language("Main"));
        Assert.Equal("hi", SportsCatalog.Language("Hindi"));
    }

    [Fact]
    public void AnEmbedUrlGivesItsHostAndSlug()
    {
        Assert.Equal(("embed.example", "ucl/2026-11-04/fen-liv"), PpvResolver.Parse("https://embed.example/embed/ucl/2026-11-04/fen-liv"));
        Assert.Equal(("embed.example", "247-willow"), PpvResolver.Parse("https://embed.example/embed/247-willow"));
        Assert.Throws<ServiceException>(() => PpvResolver.Parse("https://embed.example/watch/x"));
        Assert.Throws<ServiceException>(() => PpvResolver.Parse("http://embed.example/embed/x"));
    }

    [Fact]
    public async Task ServesTheCatalogWithPlayUrls()
    {
        var stub = new StubUpstream
        {
            Respond = r => Task.FromResult(r.RequestUri.AbsoluteUri == "https://api.ppv.st/api/streams"
                ? StubUpstream.Text(Schedule, "application/json") : StubUpstream.Text("", status: HttpStatusCode.NotFound))
        };
        var catalog = new SportsCatalog(new Upstream(stub) { Attempts = 1 }, new LogRing());
        var json = JsonReader.Parse(await catalog.JsonAsync("http://tv:11471", CancellationToken.None));
        var items = (List<object>)JsonReader.Get(json, "items");
        Assert.Equal(2, items.Count);
        var stream = ((List<object>)JsonReader.Get(items[1], "streams"))[0];
        var id = SportsCatalog.FeedId("ppv", "31615");
        Assert.Equal("http://tv:11471/sports/play/" + id + ".m3u8", JsonReader.Str(stream, "url"));
        Assert.Equal("en", JsonReader.Str(stream, "language"));
        Assert.Equal(1793059000000.0, JsonReader.Get(items[1], "endsAt"));
        var provider = ((List<object>)JsonReader.Get(json, "providers"))[0];
        Assert.Equal(("PPV", "ok"), (JsonReader.Str(provider, "name"), JsonReader.Str(provider, "status")));
        Assert.Equal("https://embed.example/embed/ucl/2026-11-04/fen-liv", (await catalog.FeedAsync(id, CancellationToken.None)).Embed);
        Assert.Null(await catalog.FeedAsync("s-unknown", CancellationToken.None));
    }

    [Fact]
    public async Task KeepsTheLastScheduleWhenAReloadFails()
    {
        var now = new DateTime(2026, 10, 26, 12, 0, 0, DateTimeKind.Utc);
        bool down = false;
        var stub = new StubUpstream { Respond = r => Task.FromResult(down ? StubUpstream.Text("", status: HttpStatusCode.BadGateway) : StubUpstream.Text(Schedule, "application/json")) };
        var catalog = new SportsCatalog(new Upstream(stub) { Attempts = 1 }, new LogRing(), () => now);
        await catalog.JsonAsync("http://tv", CancellationToken.None);
        down = true;
        now = now.AddMinutes(2);
        var stale = JsonReader.Parse(await catalog.JsonAsync("http://tv", CancellationToken.None));
        Assert.Equal("stale", JsonReader.Str(((List<object>)JsonReader.Get(stale, "providers"))[0], "status"));
        now = now.AddHours(7);
        var e = await Assert.ThrowsAsync<ServiceException>(() => catalog.JsonAsync("http://tv", CancellationToken.None));
        Assert.Equal(503, e.Status);
    }

    [Fact]
    public async Task ReportsHealthAndPicksAChannelToTestWith()
    {
        var stub = new StubUpstream { Respond = r => Task.FromResult(StubUpstream.Text(Schedule, "application/json")) };
        var catalog = new SportsCatalog(new Upstream(stub) { Attempts = 1 }, new LogRing());
        Assert.Equal("none", catalog.Status.status);
        Assert.Equal("Willow", (await catalog.TestItemAsync(CancellationToken.None)).Title);
        Assert.Equal("ok", catalog.Status.status);

        // A resolver that can't get its module records the failure for Settings.
        var resolver = new PpvResolver(new LogRing(), new StubUpstream { Respond = r => Task.FromResult(StubUpstream.Text("", status: HttpStatusCode.NotFound)) });
        await Assert.ThrowsAnyAsync<Exception>(() => resolver.ResolveAsync("https://embed.example/embed/247-willow", CancellationToken.None));
        Assert.NotNull(resolver.ErrorAt);
        Assert.Contains("404", resolver.Error);
        Assert.Null(resolver.OkAt);
    }
}

public class SportsScoresTests
{
    // ESPN's scoreboard header, trimmed to what SportsScores reads.
    const string Cricket = "{\"sports\":[{\"leagues\":[{\"slug\":\"8044\",\"events\":[" +
        "{\"id\":\"1001\",\"status\":\"in\",\"date\":\"2026-10-26T10:00:00Z\",\"fullStatus\":{\"summary\":\"India A lead by 284 runs\"},\"competitors\":[" +
        "{\"displayName\":\"New Zealand A\",\"abbreviation\":\"NZ-A\",\"score\":\"317\",\"order\":2,\"logo\":\"https://a/nz.png\"}," +
        "{\"displayName\":\"India A\",\"abbreviation\":\"IND-A\",\"score\":\"113 & 488/8 (119 ov)\",\"order\":1,\"logo\":\"https://a/ind.png\"}]}," +
        "{\"status\":\"in\",\"date\":\"2026-10-26T12:00:00Z\",\"fullStatus\":{\"summary\":\"Australia need 40 runs\"},\"competitors\":[" +
        "{\"displayName\":\"India\",\"abbreviation\":\"IND\",\"score\":\"182/4 (20 ov)\",\"order\":1,\"logo\":\"https://a/i.png\"}," +
        "{\"displayName\":\"Australia\",\"abbreviation\":\"AUS\",\"score\":\"143/6 (17 ov)\",\"order\":2,\"logo\":\"https://a/a.png\"}]}," +
        "{\"status\":\"pre\",\"date\":\"2026-10-27T10:00:00Z\",\"competitors\":[{\"displayName\":\"Nepal\"},{\"displayName\":\"UAE\"}]}]}]}]}";
    const string Football = "{\"sports\":[{\"leagues\":[{\"events\":[" +
        "{\"status\":\"in\",\"date\":\"2026-10-26T16:00:00Z\",\"fullStatus\":{\"displayClock\":\"67'\",\"type\":{\"shortDetail\":\"67'\"}},\"competitors\":[" +
        "{\"displayName\":\"Chelsea\",\"abbreviation\":\"CHE\",\"score\":\"1\",\"homeAway\":\"away\",\"logo\":\"https://a/che.png\"}," +
        "{\"displayName\":\"Arsenal\",\"abbreviation\":\"ARS\",\"score\":\"2\",\"homeAway\":\"home\",\"logo\":\"https://a/ars.png\"}]}]}]}]}";

    static double At(string iso) => DateTimeOffset.Parse(iso).ToUnixTimeMilliseconds();

    [Fact]
    public void MatchesListingsToLiveScoresByBothTeams()
    {
        var games = SportsScores.Parse(JsonReader.Parse(Cricket), false).Concat(SportsScores.Parse(JsonReader.Parse(Football), true)).ToList();
        Assert.Equal(4, games.Count);
        Assert.Null(games[2].Score); // the upcoming game has no score yet
        Assert.Equal(("cricket", "8044", "1001"), (games[0].Sport, games[0].League, games[0].Event));
        var india = SportsScores.Match("India vs Australia, 3rd T20I", At("2026-10-26T12:00:00Z"), games).Score;
        Assert.Equal("IND 182/4 (20 ov) · AUS 143/6 (17 ov)", india.Line); // not India A's game
        Assert.Equal("Australia need 40 runs", india.Summary);
        var football = SportsScores.Match("Arsenal FC vs Chelsea", At("2026-10-26T16:00:00Z"), games).Score;
        Assert.Equal("ARS 2 – 1 CHE · 67'", football.Line); // home team first, whichever side the title lists
        Assert.Equal(new[] { "https://a/che.png", "https://a/ars.png" }, football.Crests);
        Assert.Null(SportsScores.Match("Arsenal vs Chelsea", At("2026-10-28T16:00:00Z"), games)); // another day's fixture
        Assert.Null(SportsScores.Match("Willow Cricket", 0, games));
    }
}

public class SportsBoardsTests
{
    [Fact]
    public async Task ServesEspnBoardsTrimmedAndKeptForAMinute()
    {
        var stub = new StubUpstream();
        stub.Respond = r => Task.FromResult(StubUpstream.Text("{\"sports\":[{\"leagues\":[{\"slug\":\"eng.1\",\"name\":\"English Premier League\",\"links\":[{\"href\":\"x\"}],\"events\":[" +
            "{\"id\":\"9\",\"status\":\"pre\",\"date\":\"2026-11-08T14:00Z\",\"odds\":{\"spread\":1.5},\"fullStatus\":{\"displayClock\":\"0'\",\"type\":{\"completed\":false,\"shortDetail\":\"Sun 9:00 AM\"}}," +
            "\"competitors\":[{\"homeAway\":\"home\",\"displayName\":\"Brighton\",\"order\":1,\"logo\":\"https://a/b.png\",\"form\":\"WWD\",\"links\":[]}]}]}]}]}", "application/json"));
        var now = new DateTime(2026, 11, 8, 10, 0, 0, DateTimeKind.Utc);
        var boards = new SportsBoards(new Upstream(stub) { Attempts = 1 }, new LogRing(), () => now);
        var service = new HttpService(new FakeBackend(), new LogRing(), new Routes(boards));
        service.Start(IPAddress.Loopback, 0);
        try
        {
            var http = new HttpClient();
            var url = "http://127.0.0.1:" + service.Port + "/sports/board?sport=soccer&date=20261108";
            var body = await http.GetStringAsync(url);
            Assert.Equal("{\"sports\":[{\"leagues\":[{\"slug\":\"eng.1\",\"name\":\"English Premier League\",\"events\":[" +
                "{\"id\":\"9\",\"status\":\"pre\",\"date\":\"2026-11-08T14:00Z\",\"fullStatus\":{\"displayClock\":\"0'\",\"type\":{\"completed\":false,\"shortDetail\":\"Sun 9:00 AM\"}}," +
                "\"competitors\":[{\"homeAway\":\"home\",\"displayName\":\"Brighton\",\"order\":1,\"logo\":\"https://a/b.png\"}]}]}]}]}", body);
            Assert.EndsWith("header?sport=soccer&dates=20261108", stub.Requests[0].RequestUri.AbsoluteUri);
            await http.GetStringAsync(url);
            Assert.Single(stub.Requests); // the second ask within a minute is the kept board
            now = now.AddMinutes(2);
            await http.GetStringAsync(url);
            Assert.Equal(2, stub.Requests.Count);
            var bad = await http.GetAsync("http://127.0.0.1:" + service.Port + "/sports/board?sport=tennis&date=20261108");
            Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        }
        finally { service.Stop(); }
    }
}

public class SportsRelayTests : IDisposable
{
    readonly StubUpstream stub = new StubUpstream();
    readonly HttpService service;
    readonly StreamServer streams;
    readonly HttpClient http = new HttpClient();
    readonly string baseUrl;
    static readonly byte[] Ts = Enumerable.Range(0, 188 * 20).Select(i => i % 188 == 0 ? (byte)0x47 : (byte)(i * 7)).ToArray();
    string live, fresh;

    /// <summary>The sports play route, reduced to the relay call with a refresh, as SportsRoutes makes it.</summary>
    class PlayRoute : IHttpRoutes
    {
        public StreamServer Relay;
        public Func<string> Link, Refresh;
        public async Task<bool> TryHandleAsync(HttpRequest req, string[] path, Stream net)
        {
            if (path.Length != 1 || path[0] != "play.m3u8")
                return false;
            await Relay.RelayLinkAsync(req, net, Link(), () => Task.FromResult(Refresh()));
            return true;
        }
    }

    public SportsRelayTests()
    {
        var wrapped = Encoding.ASCII.GetBytes("RIFF\0\0\0\0WEBPVP8 ").Concat(new byte[50]).Concat(Ts).ToArray();
        stub.Respond = r => Task.FromResult(r.RequestUri.AbsoluteUri switch
        {
            "https://lb1.example/secure/old/playlist.m3u8" => StubUpstream.Text("expired", status: HttpStatusCode.Forbidden),
            "https://lb1.example/secure/new/playlist.m3u8" => StubUpstream.Text("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x1080\nhigh/mono.m3u8\n"),
            "https://lb1.example/secure/new/high/mono.m3u8" => StubUpstream.Text("#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:40\n" + string.Concat(Enumerable.Range(40, 8).Select(i => "#EXTINF:6,\nseg-" + i + ".webp\n"))),
            _ when r.RequestUri.AbsolutePath.Contains("/seg-") => StubUpstream.Bytes(wrapped, "image/webp"),
            _ => StubUpstream.Text("", status: HttpStatusCode.NotFound),
        });
        var upstream = new Upstream(stub) { Attempts = 1 };
        streams = new StreamServer(new SourceFinder(new IStreamProvider[0], new LogRing()), upstream, new LogRing());
        live = streams.Links.Add("https://lb1.example/secure/old/playlist.m3u8", PpvResolver.StreamHeaders("embed.st"));
        var route = new PlayRoute { Relay = streams, Link = () => live,
            Refresh = () => fresh = streams.Links.Add("https://lb1.example/secure/new/playlist.m3u8", PpvResolver.StreamHeaders("embed.st")) };
        service = new HttpService(new FakeBackend(), new LogRing(), new Routes(streams, route));
        service.Start(IPAddress.Loopback, 0);
        baseUrl = "http://127.0.0.1:" + service.Port;
    }

    public void Dispose() => service.Stop();

    [Fact]
    public async Task AnExpiredStreamIsResolvedAgainAndLiveSegmentsAreUnwrapped()
    {
        var master = await http.GetStringAsync(baseUrl + "/play.m3u8");
        Assert.NotNull(fresh); // the 403 asked for a new link
        var media = master.Split('\n').Single(l => l.StartsWith("http"));
        var segments = (await http.GetStringAsync(media)).Split('\n').Where(l => l.StartsWith("http")).ToList();
        Assert.Equal(8, segments.Count);
        Assert.Equal("https://embed.st/", stub.Requests.Last(r => r.RequestUri.AbsolutePath.EndsWith("mono.m3u8")).Headers.Referrer.ToString());

        // Live: the newest three segments are fetched with the playlist, not the first ones.
        await Task.Delay(300);
        Assert.Equal(1, stub.Count("https://lb1.example/secure/new/high/seg-47.webp"));
        Assert.Equal(0, stub.Count("https://lb1.example/secure/new/high/seg-40.webp"));
        var segment = await http.GetAsync(segments[7]);
        Assert.Equal("video/mp2t", segment.Content.Headers.ContentType.MediaType);
        Assert.Equal(Ts, await segment.Content.ReadAsByteArrayAsync()); // the WebP wrapper is gone
        Assert.Equal(1, stub.Count("https://lb1.example/secure/new/high/seg-47.webp")); // served from the read-ahead

        // A reload lists the same segments under new links; they are not fetched again.
        await http.GetStringAsync(media);
        await Task.Delay(300);
        Assert.Equal(1, stub.Count("https://lb1.example/secure/new/high/seg-46.webp"));
    }

    [Fact]
    public void OnlyImagesAreUnwrapped()
    {
        var random = new byte[5000];
        new Random(1).NextBytes(random);
        random[100] = random[288] = random[476] = 0x47; // an encrypted segment can contain the pattern by chance
        Assert.Same(random, Hls.UnwrapTs(random));
        Assert.Equal(Ts, Hls.UnwrapTs(Encoding.ASCII.GetBytes("RIFF....WEBP").Concat(Ts).ToArray()));
    }
}
