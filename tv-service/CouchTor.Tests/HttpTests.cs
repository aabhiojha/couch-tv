using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using CouchTor;
using Xunit;

class FakeBackend : ITorrentBackend
{
    public byte[] Data = Enumerable.Range(0, 100_000).Select(i => (byte)(i * 7)).ToArray();
    public string Name = "Movie.mkv";
    public List<(string hash, int idx, IReadOnlyList<string> trackers)> Opened = new List<(string, int, IReadOnlyList<string>)>();
    public List<string> Removed = new List<string>();
    public int Open;
    public TaskCompletionSource<bool> Gate; // when set, reads wait for it

    class File : IStreamFile
    {
        public FakeBackend B;
        public string Name => B.Name;
        public long Length => B.Data.Length;
        public async Task<int> ReadAsync(long position, byte[] buffer, int offset, int count, CancellationToken token)
        {
            if (B.Gate != null)
                await B.Gate.Task.WaitAsync(token);
            int n = (int)Math.Min(count, B.Data.Length - position);
            Array.Copy(B.Data, position, buffer, offset, n);
            return n;
        }
        public void Dispose() => Interlocked.Decrement(ref B.Open);
    }

    public Task<IStreamFile> OpenAsync(string infoHash, int fileIdx, IReadOnlyList<string> trackers, CancellationToken token)
    {
        if (fileIdx > 3)
            throw new ServiceException(404, "no file " + fileIdx);
        lock (Opened)
            Opened.Add((infoHash, fileIdx, trackers));
        Interlocked.Increment(ref Open);
        return Task.FromResult<IStreamFile>(new File { B = this });
    }

    public TorrentStats Stats(string infoHash, int? fileIdx)
        => infoHash.StartsWith("aa") ? new TorrentStats { Peers = 3, DownloadSpeed = 1000, Downloaded = 5, State = "downloading", StreamLen = Data.Length, StreamProgress = 0.5 } : null;

    public IReadOnlyList<KeyValuePair<string, TorrentStats>> AllStats()
        => new[] { new KeyValuePair<string, TorrentStats>(new string('a', 40), Stats("aa", null)) };

    public Task RemoveAsync(string infoHash) { lock (Removed) Removed.Add(infoHash); return Task.CompletedTask; }
    public string Debug(IReadOnlyList<KeyValuePair<string, string>> query) => "debug";
}

public class HttpTests : IDisposable
{
    [Fact]
    public void TheTrailerPageTakesOnlyAYouTubeId()
    {
        Assert.Contains("youtube.com/embed/qvsgGtivCgs?", HttpService.TrailerPage("qvsgGtivCgs"));
        Assert.Equal(400, Assert.Throws<ServiceException>(() => HttpService.TrailerPage("x\"><script>")).Status);
        Assert.Throws<ServiceException>(() => HttpService.TrailerPage(null));
    }

    static readonly string Hash = new string('a', 40);
    readonly FakeBackend backend = new FakeBackend();
    readonly LogRing log = new LogRing();
    readonly HttpService service;
    readonly HttpClient http = new HttpClient();
    readonly string baseUrl;

    public HttpTests()
    {
        service = new HttpService(backend, log);
        service.Start(IPAddress.Loopback, 0);
        baseUrl = "http://127.0.0.1:" + service.Port;
    }

    public void Dispose() => service.Stop();

    async Task<HttpResponseMessage> Get(string path, string range = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, baseUrl + path);
        if (range != null)
            req.Headers.TryAddWithoutValidation("Range", range);
        return await http.SendAsync(req);
    }

    [Fact]
    public async Task Heartbeat()
    {
        var r = await Get("/heartbeat");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("{\"success\":true}", await r.Content.ReadAsStringAsync());
        Assert.Equal("*", r.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal("application/json", r.Content.Headers.ContentType.MediaType);
    }

    [Fact]
    public async Task RangeGives206()
    {
        var r = await Get("/" + Hash + "/0", "bytes=10-19");
        Assert.Equal(HttpStatusCode.PartialContent, r.StatusCode);
        Assert.Equal("bytes 10-19/100000", r.Content.Headers.ContentRange.ToString());
        Assert.Equal("bytes", r.Headers.AcceptRanges.Single());
        Assert.Equal("video/x-matroska", r.Content.Headers.ContentType.MediaType);
        Assert.Equal("*", r.Headers.GetValues("Access-Control-Allow-Origin").Single());
        Assert.Equal(backend.Data.Skip(10).Take(10), await r.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task OpenEndedRangeAndWholeFile()
    {
        var r = await Get("/" + Hash + "/0", "bytes=99990-");
        Assert.Equal(HttpStatusCode.PartialContent, r.StatusCode);
        Assert.Equal(10, (await r.Content.ReadAsByteArrayAsync()).Length);
        r = await Get("/" + Hash + "/-1");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(backend.Data, await r.Content.ReadAsByteArrayAsync());
        Assert.Equal(100000, r.Content.Headers.ContentLength);
    }

    [Fact]
    public async Task UnsatisfiableRange()
    {
        var r = await Get("/" + Hash + "/0", "bytes=200000-");
        Assert.Equal((HttpStatusCode)416, r.StatusCode);
        Assert.Equal("bytes */100000", r.Content.Headers.ContentRange.ToString());
    }

    [Fact]
    public async Task TrackersAndCaseAreHonoured()
    {
        var tr1 = "udp://tracker.example:1337/announce";
        var tr2 = "https://t.example/a?x=1&y=2";
        await (await Get("/" + Hash.ToUpperInvariant() + "/2?tr=" + Uri.EscapeDataString(tr1) + "&tr=" + Uri.EscapeDataString(tr2), "bytes=0-0")).Content.ReadAsByteArrayAsync();
        var o = backend.Opened.Single();
        Assert.Equal(Hash, o.hash);
        Assert.Equal(2, o.idx);
        Assert.Equal(new[] { tr1, tr2 }, o.trackers);
    }

    [Fact]
    public async Task BackendErrorsBecomeStatusCodes()
    {
        var r = await Get("/" + Hash + "/9");
        Assert.Equal(HttpStatusCode.NotFound, r.StatusCode);
        Assert.Contains("no file 9", await r.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.NotFound, (await Get("/nothash/0")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Get("/" + Hash + "/x")).StatusCode);
    }

    [Fact]
    public async Task StatsRoutes()
    {
        var s = await (await Get("/" + Hash + "/0/stats.json")).Content.ReadAsStringAsync();
        Assert.Contains("\"peers\":3", s);
        Assert.Contains("\"streamLen\":100000", s);
        Assert.Contains("\"streamProgress\":0.5", s);
        Assert.Contains("\"state\":\"downloading\"", s);
        s = await (await Get("/" + Hash + "/stats.json")).Content.ReadAsStringAsync();
        Assert.DoesNotContain("streamLen", s);
        Assert.Contains("\"downloadSpeed\":1000", s);
        s = await (await Get("/stats.json")).Content.ReadAsStringAsync();
        Assert.StartsWith("{\"" + Hash + "\":{", s);
        Assert.Equal(HttpStatusCode.NotFound, (await Get("/" + new string('b', 40) + "/stats.json")).StatusCode);
    }

    [Fact]
    public async Task RemoveAndLog()
    {
        log.Add("hello");
        Assert.Equal("{}", await (await Get("/" + Hash + "/remove")).Content.ReadAsStringAsync());
        Assert.Equal(new[] { Hash }, backend.Removed);
        var r = await Get("/log");
        Assert.Equal("text/plain", r.Content.Headers.ContentType.MediaType);
        Assert.Contains("hello", await r.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Preflight()
    {
        var req = new HttpRequestMessage(HttpMethod.Options, baseUrl + "/" + Hash + "/0");
        req.Headers.TryAddWithoutValidation("Access-Control-Request-Headers", "range");
        var r = await http.SendAsync(req);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("range", r.Headers.GetValues("Access-Control-Allow-Headers").Single());
    }

    [Fact]
    public async Task NewRequestForSameFileEndsThePreviousStream()
    {
        backend.Gate = new TaskCompletionSource<bool>();
        var first = new TcpClient();
        await first.ConnectAsync(IPAddress.Loopback, service.Port);
        var s1 = first.GetStream();
        var head = Encoding.ASCII.GetBytes("GET /" + Hash + "/0 HTTP/1.1\r\nRange: bytes=0-\r\n\r\n");
        await s1.WriteAsync(head);
        await WaitFor(() => backend.Open == 1);

        var second = Get("/" + Hash + "/0", "bytes=5-9"); // blocks on the gate too
        await WaitFor(() => backend.Opened.Count == 2);
        // the first connection is closed by the server
        var buf = new byte[4096];
        var read = Task.Run(async () => { while (await s1.ReadAsync(buf) > 0) { } });
        Assert.True(await Task.WhenAny(read, Task.Delay(5000)) == read, "first stream not closed");
        backend.Gate.SetResult(true);
        var r = await second;
        Assert.Equal(backend.Data.Skip(5).Take(5), await r.Content.ReadAsByteArrayAsync());
        await WaitFor(() => backend.Open == 0);
    }

    [Fact]
    public async Task HeadDoesNotEndTheActiveStream()
    {
        backend.Gate = new TaskCompletionSource<bool>();
        var get = Get("/" + Hash + "/0", "bytes=0-99");
        await WaitFor(() => backend.Opened.Count == 1);
        var head = await http.SendAsync(new HttpRequestMessage(HttpMethod.Head, baseUrl + "/" + Hash + "/0"));
        Assert.Equal(HttpStatusCode.OK, head.StatusCode);
        backend.Gate.SetResult(true);
        var r = await get;
        Assert.Equal(HttpStatusCode.PartialContent, r.StatusCode);
        Assert.Equal(backend.Data.Take(100), await r.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task ClientThatStopsReadingIsDisconnected()
    {
        backend.Data = new byte[64 << 20];
        service.WriteTimeout = TimeSpan.FromSeconds(1);
        using var c = new TcpClient { ReceiveBufferSize = 4096 };
        await c.ConnectAsync(IPAddress.Loopback, service.Port);
        await c.GetStream().WriteAsync(Encoding.ASCII.GetBytes("GET /" + Hash + "/0 HTTP/1.1\r\n\r\n"));
        await WaitFor(() => backend.Opened.Count == 1);
        // never read: the server's writes fill the socket buffers and stall
        for (int i = 0; i < 400 && backend.Open != 0; i++)
            await Task.Delay(25);
        Assert.Equal(0, backend.Open);
        Assert.Contains("stopped reading", log.Text());
    }

    [Fact]
    public async Task OtherFilesKeepStreaming()
    {
        await (await Get("/" + Hash + "/0", "bytes=0-0")).Content.ReadAsByteArrayAsync();
        await (await Get("/" + Hash + "/1", "bytes=0-0")).Content.ReadAsByteArrayAsync();
        await WaitFor(() => backend.Open == 0);
    }

    [Fact]
    public async Task MalformedRequestIs400()
    {
        using var c = new TcpClient();
        await c.ConnectAsync(IPAddress.Loopback, service.Port);
        var s = c.GetStream();
        await s.WriteAsync(Encoding.ASCII.GetBytes("garbage\r\n\r\n"));
        var text = await new StreamReader(s).ReadToEndAsync();
        Assert.StartsWith("HTTP/1.1 400", text);
    }

    [Fact]
    public async Task HeadSendsHeadersOnly()
    {
        var r = await http.SendAsync(new HttpRequestMessage(HttpMethod.Head, baseUrl + "/" + Hash + "/0"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal(100000, r.Content.Headers.ContentLength);
    }

    [Fact]
    public void ParsesAbsoluteTargetsAndQueries()
    {
        var req = HttpRequest.Parse("GET http://tv:11470/a%20b/c?tr=x%3Ay&k HTTP/1.1\r\nHost: tv");
        Assert.Equal("/a b/c", req.Path);
        Assert.Equal(new[] { "x:y" }, req.QueryAll("tr"));
        Assert.Equal("", req.QueryAll("k").Single());
        Assert.Equal("tv", req.Header("host"));
    }

    static async Task WaitFor(Func<bool> condition)
    {
        for (int i = 0; i < 200 && !condition(); i++)
            await Task.Delay(25);
        Assert.True(condition());
    }
}
