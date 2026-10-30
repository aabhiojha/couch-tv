using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CouchTor;
using CouchTor.Streams;
using Xunit;

/// <summary>Answers upstream requests from a function, and records them.</summary>
class StubUpstream : HttpMessageHandler
{
    public Func<HttpRequestMessage, Task<HttpResponseMessage>> Respond;
    public List<HttpRequestMessage> Requests = new List<HttpRequestMessage>();

    public static HttpResponseMessage Text(string body, string type = "text/plain", HttpStatusCode status = HttpStatusCode.OK)
        => new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, type) };

    public static HttpResponseMessage Bytes(byte[] body, string type)
    {
        var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) };
        r.Content.Headers.TryAddWithoutValidation("Content-Type", type);
        return r;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
    {
        lock (Requests)
            Requests.Add(request);
        var answer = Respond(request);
        // Like a real connection, a request that is cancelled stops waiting.
        await Task.WhenAny(answer, Task.Delay(-1, token));
        token.ThrowIfCancellationRequested();
        var response = await answer;
        response.RequestMessage = request;
        return response;
    }

    public int Count(string url) { lock (Requests) return Requests.Count(r => r.RequestUri.AbsoluteUri == url); }
}

public class JsonReaderTests
{
    [Fact]
    public void ParsesProviderAnswers()
    {
        var json = JsonReader.Parse("{\"src\":\"\\/embed\\/1?t=a\",\"n\":-1.5e2,\"ok\":true,\"none\":null,\"list\":[1,\"x\",{\"k\":\"\\u00e9\"}]}");
        Assert.Equal("/embed/1?t=a", JsonReader.Str(json, "src"));
        Assert.Equal(-150.0, JsonReader.Get(json, "n"));
        Assert.Equal(true, JsonReader.Get(json, "ok"));
        Assert.Null(JsonReader.Get(json, "none"));
        Assert.Equal("é", JsonReader.Str(((List<object>)JsonReader.Get(json, "list"))[2], "k"));
        Assert.Null(JsonReader.Str(json, "missing", "deeper"));
        Assert.Throws<System.IO.InvalidDataException>(() => JsonReader.Parse("{\"a\":1"));
        Assert.Throws<System.IO.InvalidDataException>(() => JsonReader.Parse("<html>"));
    }
}

public class HlsTests
{
    const string Master = "#EXTM3U\n" +
        "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",LANGUAGE=\"ita\",NAME=\"Italian\",DEFAULT=YES,AUTOSELECT=YES,URI=\"audio/it.m3u8\"\n" +
        "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"a\",LANGUAGE=\"eng\",NAME=\"English\",DEFAULT=NO,AUTOSELECT=NO,URI=\"audio/en.m3u8\"\n" +
        "#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=854x480,AUDIO=\"a\"\nv480.m3u8\n" +
        "#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720,AUDIO=\"a\"\nv720.m3u8\n" +
        "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x800,AUDIO=\"a\"\nhttps://other.example/v1080.m3u8?token=a%2Fb\n";

    static string Relay(string url) => "R(" + url + ")";

    [Fact]
    public void DetectsPlaylistsByContent()
    {
        Assert.True(Hls.IsPlaylist(Encoding.UTF8.GetBytes("\uFEFF\n  #EXTM3U\n")));
        Assert.False(Hls.IsPlaylist(new byte[] { 0x47, 0x40, 0x00 }));
        Assert.False(Hls.IsPlaylist(Encoding.UTF8.GetBytes("<html>#EXTM3U")));
    }

    [Fact]
    public void KeepsTheBestRenditionAndTheOriginalAudio()
    {
        var text = Hls.Rewrite(Master, "https://cdn.example/m/master.m3u8", Relay, null);
        Assert.DoesNotContain("Italian", text);
        Assert.Contains("NAME=\"English\",DEFAULT=YES,AUTOSELECT=YES,URI=\"R(https://cdn.example/m/audio/en.m3u8)\"", text);
        Assert.Single(text.Split('\n'), l => l.StartsWith("#EXT-X-STREAM-INF"));
        // A 1920x800 scope film is the 1080p class; an absolute URL keeps its escapes.
        Assert.Contains("R(https://other.example/v1080.m3u8?token=a%2Fb)", text);
    }

    [Fact]
    public void QualityPicksTheBestAtOrBelowItsClass()
    {
        var text = Hls.Rewrite(Master, "https://cdn.example/m/master.m3u8", Relay, "720");
        Assert.Contains("R(https://cdn.example/m/v720.m3u8)", text);
        Assert.DoesNotContain("v1080", text);
        Assert.DoesNotContain("v480", text);
        var below = Hls.Rewrite(Master.Replace("854x480", "640x360"), "https://cdn.example/m/master.m3u8", Relay, "240");
        Assert.Contains("v480.m3u8", below); // nothing that low: the lowest-bandwidth rendition
        var all = Hls.Rewrite(Master, "https://cdn.example/m/master.m3u8", Relay, "all");
        Assert.Equal(3, all.Split('\n').Count(l => l.StartsWith("#EXT-X-STREAM-INF")));
    }

    [Fact]
    public void ListsMediaSegmentsInOrder()
    {
        var segments = new List<string>();
        var media = "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"/key\"\n#EXTINF:6,\nseg-0.html\n#EXTINF:6,\n\nseg-1.html\n#EXT-X-ENDLIST";
        var text = Hls.Rewrite(media, "https://cdn.example/m/index.m3u8", Relay, null, segments);
        Assert.Equal(new[] { "R(https://cdn.example/m/seg-0.html)", "R(https://cdn.example/m/seg-1.html)" }, segments);
        Assert.Contains("URI=\"R(https://cdn.example/key)\"", text);
        var master = new List<string>();
        Hls.Rewrite(Master, "https://cdn.example/m/master.m3u8", Relay, "all", master);
        Assert.Empty(master);
    }

    [Fact]
    public void LinksStayBounded()
    {
        var links = new ProxyLinks { Capacity = 10, Trim = 4 };
        var ids = Enumerable.Range(0, 11).Select(i => links.Add("https://x/" + i, null)).ToList();
        Assert.Equal(7, links.Count);
        Assert.Null(links.Get(ids[0]));
        Assert.Equal("https://x/10", links.Get(ids[10]).Url);
        links.SetPlaylist(ids.Skip(8).ToList());
        Assert.Equal(1, links.Get(ids[9]).Index);
    }
}

public class UpstreamTests
{
    static readonly Dictionary<string, string> WithReferer = new Dictionary<string, string> { ["Referer"] = "https://player.example/", ["Origin"] = "https://player.example", ["User-Agent"] = "UA" };

    [Fact]
    public async Task A403WithRefererIsRetriedWithoutIt()
    {
        var stub = new StubUpstream
        {
            Respond = r => Task.FromResult(r.Headers.Referrer != null ? StubUpstream.Text("no", status: HttpStatusCode.Forbidden) : StubUpstream.Text("seg"))
        };
        var f = await new Upstream(stub).GetAsync("https://seg.example/page-0.html", WithReferer, CancellationToken.None);
        Assert.Equal(200, f.Status);
        Assert.Equal(2, stub.Requests.Count);
        Assert.False(stub.Requests[1].Headers.Contains("Origin"));
        Assert.Equal("UA", stub.Requests[1].Headers.UserAgent.ToString());
    }

    [Fact]
    public async Task A5xxOrTimeoutIsRetried()
    {
        int calls = 0;
        var stub = new StubUpstream { Respond = r => Task.FromResult(++calls == 1 ? StubUpstream.Text("busy", status: HttpStatusCode.BadGateway) : StubUpstream.Text("ok")) };
        Assert.Equal("ok", (await new Upstream(stub).GetAsync("https://a.example/", null, CancellationToken.None)).Text());
        var hang = new StubUpstream { Respond = async r => { await Task.Delay(2000); return StubUpstream.Text("late"); } };
        var slow = new Upstream(hang) { AttemptTimeout = TimeSpan.FromMilliseconds(100) };
        var watch = Stopwatch.StartNew();
        await Assert.ThrowsAsync<TimeoutException>(() => slow.GetAsync("https://slow.example/", null, CancellationToken.None));
        Assert.Equal(3, hang.Requests.Count);
        Assert.True(watch.ElapsedMilliseconds < 1500);
    }
}

public class ProviderTests
{
    [Fact]
    public async Task VixSrcFollowsApiEmbedAndPlaylist()
    {
        var now = new DateTime(2026, 10, 26, 12, 0, 0, DateTimeKind.Utc);
        long expires = new DateTimeOffset(now.AddHours(2)).ToUnixTimeSeconds();
        var stub = new StubUpstream
        {
            Respond = r => Task.FromResult(r.RequestUri.AbsoluteUri switch
            {
                "https://vixsrc.to/api/tv/1399/2/3" => StubUpstream.Text("{\"src\":\"\\/embed\\/77?token=x\"}", "application/json"),
                "https://vixsrc.to/embed/77?token=x" => StubUpstream.Text("<script>window.masterPlaylist = { params: { 'token': 'TOK', 'expires': '" + expires + "' }, url: 'https://vixsrc.to/playlist/77?b=1' }</script>", "text/html"),
                _ when r.RequestUri.AbsoluteUri == "https://vixsrc.to/playlist/77?b=1&token=TOK&expires=" + expires + "&h=1" =>
                    StubUpstream.Text("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\na\n#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=1920x1080\nb\n"),
                _ => StubUpstream.Text("", status: HttpStatusCode.NotFound),
            })
        };
        var sources = await new VixSrc(new Upstream(stub), () => now).FindAsync(new Media { IsTv = true, TmdbId = "1399", Season = 2, Episode = 3 }, CancellationToken.None);
        var s = Assert.Single(sources);
        Assert.Equal("1080p", s.Quality);
        Assert.Equal("vixsrc", s.ProviderId);
        Assert.Equal("https://vixsrc.to/api/tv/1399/2/3", s.Headers["Referer"]);
        Assert.Empty(await new VixSrc(new Upstream(stub), () => now.AddHours(3)).FindAsync(new Media { IsTv = true, TmdbId = "1399", Season = 2, Episode = 3 }, CancellationToken.None));
        Assert.Empty(await new VixSrc(new Upstream(stub), () => now).FindAsync(new Media { TmdbId = "5" }, CancellationToken.None));
    }

    [Fact]
    public async Task VidApiListsItsStreams()
    {
        var stub = new StubUpstream
        {
            Respond = r => Task.FromResult(r.RequestUri.AbsoluteUri == "https://streamdata.vaplayer.ru/api.php?tmdb=27205&type=movie"
                ? StubUpstream.Text("{\"status_code\":\"200\",\"data\":{\"file_name\":\"Inception.2010.1080p.mkv\",\"stream_urls\":[\"https://s.example/pl/a\",\"https://s.example/film.mp4\",7]}}", "application/json")
                : StubUpstream.Text("{\"status_code\":\"404\"}", "application/json"))
        };
        var api = new VidApi(new Upstream(stub));
        var sources = await api.FindAsync(new Media { TmdbId = "27205" }, CancellationToken.None);
        Assert.Equal(new[] { "hls", "mp4" }, sources.Select(s => s.Type));
        Assert.All(sources, s => Assert.Equal("1080p", s.Quality));
        Assert.Equal("https://brightpathsignals.com/", sources[0].Headers["Referer"]);
        Assert.Empty(await api.FindAsync(new Media { TmdbId = "1" }, CancellationToken.None));
        Assert.Equal("unknown", VidApi.InferQuality(null));
    }

    class Fake : IStreamProvider
    {
        public string Id { get; set; }
        public string Name => Id;
        public int DelayMs;
        public bool Throw;
        public async Task<IReadOnlyList<Source>> FindAsync(Media media, CancellationToken token)
        {
            await Task.Delay(DelayMs, token);
            if (Throw) throw new InvalidOperationException("broken");
            return new[] { new Source { Url = "https://" + Id, ProviderId = Id } };
        }
    }

    [Fact]
    public async Task FinderAnswersAfterAGraceAndKeepsProviderOrder()
    {
        var finder = new SourceFinder(new IStreamProvider[] { new Fake { Id = "slow", DelayMs = 400 }, new Fake { Id = "fast" }, new Fake { Id = "stalls", DelayMs = 10000 }, new Fake { Id = "bad", Throw = true } },
            new LogRing()) { Grace = TimeSpan.FromMilliseconds(800) };
        var watch = Stopwatch.StartNew();
        var sources = await finder.FindAsync(new Media { TmdbId = "1" }, CancellationToken.None);
        Assert.Equal(new[] { "slow", "fast" }, sources.Select(s => s.ProviderId));
        Assert.InRange(watch.ElapsedMilliseconds, 700, 3000);
    }
}

public class StreamServerTests : IDisposable
{
    readonly StubUpstream stub = new StubUpstream();
    readonly HttpService service;
    readonly StreamServer streams;
    readonly HttpClient http = new HttpClient();
    readonly string baseUrl;
    static readonly byte[] Segment = Enumerable.Range(0, 5000).Select(i => i % 188 == 0 ? (byte)0x47 : (byte)i).ToArray();

    class OneSource : IStreamProvider
    {
        public string Id => "vixsrc";
        public string Name => "VixSrc";
        public Task<IReadOnlyList<Source>> FindAsync(Media media, CancellationToken token)
            => Task.FromResult<IReadOnlyList<Source>>(media.TmdbId == "404" ? new Source[0] : new[] { new Source { Url = "https://cdn.example/m/master.m3u8", Quality = "1080p", ProviderId = "vixsrc", ProviderName = "VixSrc",
                Headers = new Dictionary<string, string> { ["Referer"] = "https://vixsrc.to/api/movie/1" } } });
    }

    public StreamServerTests()
    {
        stub.Respond = r => Task.FromResult(r.RequestUri.AbsoluteUri switch
        {
            "https://cdn.example/m/master.m3u8" => StubUpstream.Text("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=1920x1080\nhigh/index.m3u8\n", "text/html"),
            "https://cdn.example/m/high/index.m3u8" => StubUpstream.Text("#EXTM3U\n" + string.Concat(Enumerable.Range(0, 8).Select(i => "#EXTINF:6,\npage-" + i + ".html\n")) + "#EXT-X-ENDLIST\n", "application/vnd.apple.mpegurl"),
            "https://cdn.example/film.mp4" => Range(r),
            "https://cdn.example/slow" => throw new TaskCanceledException(),
            _ when r.RequestUri.AbsolutePath.StartsWith("/m/high/page-") => StubUpstream.Bytes(Segment, "text/html; charset=UTF-8"),
            _ => StubUpstream.Text("gone", status: HttpStatusCode.NotFound),
        });
        var upstream = new Upstream(stub) { AttemptTimeout = TimeSpan.FromMilliseconds(300) };
        streams = new StreamServer(new SourceFinder(new IStreamProvider[] { new OneSource() }, new LogRing()), upstream, new LogRing());
        service = new HttpService(new FakeBackend(), new LogRing(), streams);
        service.Start(IPAddress.Loopback, 0);
        baseUrl = "http://127.0.0.1:" + service.Port;
    }

    static HttpResponseMessage Range(HttpRequestMessage r)
    {
        var range = r.Headers.Range?.Ranges.Single();
        var response = new HttpResponseMessage(range != null ? HttpStatusCode.PartialContent : HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[10]) };
        response.Content.Headers.TryAddWithoutValidation("Content-Type", "video/mp4");
        if (range != null)
            response.Content.Headers.ContentRange = new System.Net.Http.Headers.ContentRangeHeaderValue(range.From.Value, range.From.Value + 9, 1000);
        return response;
    }

    public void Dispose() => service.Stop();

    async Task<string> RelayUrl(string tmdb = "1")
    {
        var body = await http.GetStringAsync(baseUrl + "/v1/movies/" + tmdb);
        var url = JsonReader.Str(((List<object>)JsonReader.Get(JsonReader.Parse(body), "sources"))[0], "url");
        Assert.StartsWith(baseUrl + "/v1/proxy?data=", url); // the app keeps only sources under its server's /v1/proxy?
        Assert.Equal("vixsrc", JsonReader.Str(((List<object>)JsonReader.Get(JsonReader.Parse(body), "sources"))[0], "provider", "id"));
        return url.Replace("/v1/proxy?", "/v1/proxy.m3u8?");
    }

    [Fact]
    public async Task HealthAndMissingSources()
    {
        Assert.Equal(HttpStatusCode.OK, (await http.GetAsync(baseUrl + "/")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync(baseUrl + "/v1/movies/404")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await http.GetAsync(baseUrl + "/v1/movies/abc")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync(baseUrl + "/v1/proxy.m3u8?data=%40zzz")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await http.GetAsync(baseUrl + "/v1/nothing")).StatusCode);
    }

    [Fact]
    public async Task RelaysAFilmFromMasterToSegment()
    {
        var master = await http.GetAsync(await RelayUrl());
        Assert.Equal("application/vnd.apple.mpegurl", master.Content.Headers.ContentType.MediaType);
        var lines = (await master.Content.ReadAsStringAsync()).Split('\n');
        var rendition = Assert.Single(lines, l => l.StartsWith("http"));
        Assert.Contains("RESOLUTION=1920x1080", string.Join("\n", lines));
        var all = await http.GetStringAsync(await RelayUrl() + "&quality=all");
        Assert.Equal(2, all.Split('\n').Count(l => l.StartsWith("http")));

        var media = (await http.GetStringAsync(rendition)).Split('\n').Where(l => l.StartsWith("http")).ToList();
        Assert.Equal(8, media.Count);
        Assert.All(media, l => Assert.StartsWith(baseUrl + "/v1/proxy?data=%40", l));
        Assert.Equal("https://vixsrc.to/api/movie/1", stub.Requests.Last().Headers.Referrer.ToString());

        // The first three segments are fetched with the playlist; playing one starts the next few.
        await Task.Delay(300);
        var segment = await http.GetAsync(media[0]);
        Assert.Equal("video/mp2t", segment.Content.Headers.ContentType.MediaType); // labelled text/html upstream
        Assert.Equal(Segment, await segment.Content.ReadAsByteArrayAsync());
        await Task.Delay(300);
        Assert.Equal(1, stub.Count("https://cdn.example/m/high/page-0.html"));
        Assert.Equal(1, stub.Count("https://cdn.example/m/high/page-4.html"));
        Assert.Equal(0, stub.Count("https://cdn.example/m/high/page-6.html"));
        await http.GetByteArrayAsync(media[1]);
        Assert.Equal(1, stub.Count("https://cdn.example/m/high/page-1.html")); // served from the read-ahead
    }

    [Fact]
    public async Task FilmsPassThroughWithRangesAndTimeoutsAre504()
    {
        var film = streams.Links.Add("https://cdn.example/film.mp4", null);
        var req = new HttpRequestMessage(HttpMethod.Get, baseUrl + "/v1/proxy?data=%40" + film);
        req.Headers.TryAddWithoutValidation("Range", "bytes=100-");
        var r = await http.SendAsync(req);
        Assert.Equal(HttpStatusCode.PartialContent, r.StatusCode);
        Assert.Equal("bytes 100-109/1000", r.Content.Headers.ContentRange.ToString());
        Assert.Equal(10, (await r.Content.ReadAsByteArrayAsync()).Length);
        var slow = streams.Links.Add("https://cdn.example/slow", null);
        Assert.Equal(HttpStatusCode.GatewayTimeout, (await http.GetAsync(baseUrl + "/v1/proxy?data=%40" + slow)).StatusCode);
    }
}
