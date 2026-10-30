using System.Collections.Generic;
using System.Linq;
using System.Net;
using CouchTor;
using Xunit;

public class ByteRangeTests
{
    [Theory]
    [InlineData("bytes=0-99", 1000, 0, 99)]
    [InlineData("bytes=100-", 1000, 100, 999)]
    [InlineData("bytes=900-5000", 1000, 900, 999)]
    [InlineData("bytes=-100", 1000, 900, 999)]
    [InlineData("bytes=-5000", 1000, 0, 999)]
    [InlineData(" BYTES=5-5 ", 1000, 5, 5)]
    public void Satisfiable(string header, long length, long start, long end)
    {
        var r = ByteRange.Parse(header, length);
        Assert.Equal(ByteRange.Kind.Satisfiable, r.Result);
        Assert.Equal(start, r.Start);
        Assert.Equal(end, r.End);
    }

    [Theory]
    [InlineData("bytes=1000-", 1000)]
    [InlineData("bytes=5000-6000", 1000)]
    [InlineData("bytes=-0", 1000)]
    public void Unsatisfiable(string header, long length)
        => Assert.Equal(ByteRange.Kind.Unsatisfiable, ByteRange.Parse(header, length).Result);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("items=0-5")]
    [InlineData("bytes=5-1")]
    [InlineData("bytes=a-b")]
    [InlineData("bytes=0-1,5-6")]
    [InlineData("bytes=")]
    public void IgnoredServesWholeFile(string header)
    {
        var r = ByteRange.Parse(header, 1000);
        Assert.Equal(ByteRange.Kind.None, r.Result);
        Assert.Equal(0, r.Start);
        Assert.Equal(999, r.End);
    }

    [Fact]
    public void LargeOffsets()
    {
        var r = ByteRange.Parse("bytes=5905580032-6010437631", 6_500_000_000);
        Assert.Equal(104857600, r.Length);
    }
}

public class AddressFilterTests
{
    [Theory]
    [InlineData("127.0.0.1", true)]
    [InlineData("127.9.9.9", true)]
    [InlineData("10.1.2.3", true)]
    [InlineData("172.16.0.1", true)]
    [InlineData("172.31.255.255", true)]
    [InlineData("172.32.0.1", false)]
    [InlineData("172.15.0.1", false)]
    [InlineData("192.168.1.34", true)]
    [InlineData("192.169.1.1", false)]
    [InlineData("100.64.0.5", false)]
    [InlineData("8.8.8.8", false)]
    [InlineData("::1", true)]
    [InlineData("::ffff:192.168.1.34", true)]
    [InlineData("::ffff:8.8.8.8", false)]
    [InlineData("fe80::1", false)]
    [InlineData("2001:db8::1", false)]
    public void Allows(string ip, bool allowed)
        => Assert.Equal(allowed, AddressFilter.IsAllowed(IPAddress.Parse(ip)));
}

public class ContentTypeTests
{
    [Theory]
    [InlineData("a/Movie.MKV", "video/x-matroska")]
    [InlineData("x.mp4", "video/mp4")]
    [InlineData("x.avi", "video/x-msvideo")]
    [InlineData("x.ts", "video/mp2t")]
    [InlineData("x.webm", "video/webm")]
    [InlineData("x.nfo", "application/octet-stream")]
    public void ByExtension(string name, string type) => Assert.Equal(type, ContentTypes.For(name));
}

public class LogRingTests
{
    [Fact]
    public void KeepsLastLines()
    {
        var log = new LogRing(300);
        for (int i = 0; i < 1000; i++)
            log.Add("line " + i);
        var lines = log.Text().TrimEnd('\n').Split('\n');
        Assert.Equal(300, lines.Length);
        Assert.EndsWith("line 700", lines[0]);
        Assert.EndsWith("line 999", lines[299]);
    }
}

public class PieceCacheTests
{
    const long MB = 1 << 20;

    static PieceCache Cache(long free) => new PieceCache(() => free);

    [Theory]
    [InlineData(1700, 0, 1024)]   // the TV today: capped at 1 GiB
    [InlineData(1000, 0, 600)]    // free - 400 MiB
    [InlineData(500, 300, 400)]   // cache's own bytes count as free
    [InlineData(300, 0, 0)]
    public void Capacity(long freeMb, long usedMb, long capMb)
        => Assert.Equal(capMb * MB, PieceCache.CapacityFor(freeMb * MB, usedMb * MB));

    [Fact]
    public void EvictsLeastRecentlyUsedCompletePieces()
    {
        var c = Cache(10_000 * MB);
        c.CapOverride = 4 * MB;
        for (int i = 0; i < 4; i++)
            c.OnComplete("a", i, MB);
        c.OnRead("a", 0); // 0 is now the most recently used
        var gone = c.Evict(MB);
        Assert.Equal(new[] { 1 }, gone.Select(kv => kv.Value));
        Assert.Equal(3 * MB, c.UsedBytes);
        gone = c.Evict(3 * MB);
        Assert.Equal(new[] { 2, 3 }, gone.Select(kv => kv.Value)); // 3 MB used + 3 MB incoming must fit in 4 MB
    }

    [Fact]
    public void NeverEvictsProtectedWindowOrIncompletePieces()
    {
        var c = Cache(10_000 * MB);
        c.CapOverride = 4 * MB;
        for (int i = 0; i < 3; i++)
            c.OnComplete("a", i, MB);
        c.OnWrite("a", 10, MB); // downloading, not verified
        c.SetWindow("a", 1, 1, 2);
        var gone = c.Evict(4 * MB);
        Assert.Equal(new[] { 0 }, gone.Select(kv => kv.Value));
        c.ClearWindow("a", 1);
        gone = c.Evict(4 * MB);
        Assert.Equal(new[] { 1, 2 }, gone.Select(kv => kv.Value).OrderBy(i => i));
        Assert.Equal(MB, c.UsedBytes); // only the partial piece is left
    }

    [Fact]
    public void WindowsOfOtherTorrentsDontProtect()
    {
        var c = Cache(10_000 * MB);
        c.CapOverride = MB;
        c.OnComplete("a", 5, MB);
        c.SetWindow("b", 1, 0, 100);
        Assert.Single(c.Evict(MB));
    }

    [Fact]
    public void NoEvictionUnderCapacity()
    {
        var c = Cache(10_000 * MB);
        c.OnComplete("a", 0, MB);
        Assert.Empty(c.Evict(MB));
    }

    [Fact]
    public void WritesGrowAndCompleteSetsSize()
    {
        var c = Cache(10_000 * MB);
        c.OnWrite("a", 0, 16384);
        c.OnWrite("a", 0, 8192); // earlier block: no growth
        c.OnWrite("a", 0, 32768);
        Assert.Equal(32768, c.UsedBytes);
        c.OnComplete("a", 0, 65536);
        Assert.Equal(65536, c.UsedBytes);
        Assert.True(c.IsComplete("a", 0));
        Assert.Equal(new[] { 0 }, c.CompletePieces("a"));
    }

    [Fact]
    public void RemoveIncompleteAndTorrent()
    {
        var c = Cache(10_000 * MB);
        c.OnComplete("a", 0, MB);
        c.OnWrite("a", 1, MB);
        c.OnWrite("b", 0, MB);
        Assert.Equal(new[] { 1 }, c.RemoveIncomplete("a"));
        Assert.Equal(2 * MB, c.UsedBytes);
        c.RemoveTorrent("b");
        Assert.Equal(MB, c.UsedBytes);
        c.AddExisting("c", 7, MB);
        Assert.Equal(new[] { 7 }, c.CompletePieces("c"));
        // pieces found at startup are the oldest: evicted before anything used this run
        c.CapOverride = 2 * MB;
        Assert.Equal("c", c.Evict(MB).Single().Key);
    }
}
