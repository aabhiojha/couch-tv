using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace CouchTor.Streams
{
    /// <summary>The relay's links: short ids for upstream URLs and the headers to fetch them with.</summary>
    public sealed class ProxyLinks
    {
        public sealed class Link
        {
            public string Url;
            public IReadOnlyDictionary<string, string> Headers;
            /// <summary>For a segment: its media playlist's segment ids and its place in them (for read-ahead).</summary>
            public string[] Playlist;
            public int Index = -1;
        }

        readonly Dictionary<string, Link> links = new Dictionary<string, Link>();
        readonly Queue<string> order = new Queue<string>();
        long next;

        // A full film's playlist doesn't fit the TV's HLS parser when every segment URL carries the upstream URL and
        // headers, so links are ids into this map. A film is ~2,000 links; past the capacity the oldest go (a stream
        // that old has been closed or its playlist reloaded since).
        public int Capacity = 20000;
        public int Trim = 5000;

        public int Count { get { lock (links) return links.Count; } }

        public string Add(string url, IReadOnlyDictionary<string, string> headers)
        {
            lock (links)
            {
                var id = (++next).ToString("x", CultureInfo.InvariantCulture);
                links[id] = new Link { Url = url, Headers = headers };
                order.Enqueue(id);
                if (links.Count > Capacity)
                    for (int n = 0; n < Trim && order.Count > 0; n++)
                        links.Remove(order.Dequeue());
                return id;
            }
        }

        public Link Get(string id)
        {
            lock (links)
                return id != null && links.TryGetValue(id, out var link) ? link : null;
        }

        public void SetPlaylist(IReadOnlyList<string> ids)
        {
            var list = ids.ToArray();
            lock (links)
                for (int i = 0; i < list.Length; i++)
                    if (links.TryGetValue(list[i], out var link))
                    {
                        link.Playlist = list;
                        link.Index = i;
                    }
        }
    }

    /// <summary>HLS playlist handling for the relay.</summary>
    public static class Hls
    {
        static readonly Regex UriAttribute = new Regex("URI=\"([^\"]+)\"", RegexOptions.Compiled);
        static readonly Regex Width = new Regex(@"RESOLUTION=(\d+)x", RegexOptions.Compiled);
        static readonly Regex Bandwidth = new Regex(@"[:,]BANDWIDTH=(\d+)", RegexOptions.Compiled);

        /// <summary>Some hosts label playlists and segments alike as text/html, so look at the bytes.</summary>
        public static bool IsPlaylist(byte[] body)
        {
            int i = 0;
            if (body.Length >= 3 && body[0] == 0xEF && body[1] == 0xBB && body[2] == 0xBF)
                i = 3;
            while (i < body.Length && (body[i] == ' ' || body[i] == '\t' || body[i] == '\r' || body[i] == '\n'))
                i++;
            const string tag = "#EXTM3U";
            if (body.Length - i < tag.Length)
                return false;
            for (int k = 0; k < tag.Length; k++)
                if (body[i + k] != tag[k])
                    return false;
            return true;
        }

        /// <summary>
        /// Some live hosts disguise MPEG-TS segments as images (a WebP or PNG wrapper around the packets): cut out the
        /// run of 188-byte packets, found as three sync bytes 188 apart within the first 4 KB. Only bodies that start
        /// like an image are touched: an encrypted segment could contain that pattern by chance.
        /// </summary>
        public static byte[] UnwrapTs(byte[] body)
        {
            bool image = body.Length > 4 && ((body[0] == 'R' && body[1] == 'I' && body[2] == 'F' && body[3] == 'F')
                || (body[0] == 0x89 && body[1] == 'P' && body[2] == 'N' && body[3] == 'G') || (body[0] == 0xFF && body[1] == 0xD8));
            if (!image)
                return body;
            for (int i = 0; i < Math.Min(4096, body.Length - 376); i++)
                if (body[i] == 0x47 && body[i + 188] == 0x47 && body[i + 376] == 0x47)
                {
                    var ts = new byte[(body.Length - i) / 188 * 188];
                    Buffer.BlockCopy(body, i, ts, 0, ts.Length);
                    return ts;
                }
            return body;
        }

        /// <summary>
        /// Same classes as the app's quality menu, by frame width so a 1920x800 scope film counts as 1080p.
        /// </summary>
        public static int QualityClass(int width)
            => width >= 3800 ? 2160 : width >= 1900 ? 1080 : width >= 1260 ? 720 : width >= 840 ? 480 : 360;

        /// <summary>
        /// Points every URI in <paramref name="text"/> at the relay (<paramref name="relay"/> gets the absolute
        /// upstream URL and returns the replacement), then:
        /// drops subtitle renditions (the app lists them from the sources answer and draws them itself);
        /// keeps only the original-language audio, since VixSrc adds an Italian dub as the default next to it and
        /// switching tracks in AVPlay breaks seeking; and keeps one rendition, the best at or below
        /// <paramref name="quality"/> (a height class, or empty for the best), because AVPlay starts on the lowest and
        /// switching up led to NOT_SUPPORTED_FORMAT errors and hung seeks. "all" keeps every rendition so the app
        /// can list them. <paramref name="segments"/> gets the relayed URLs of a media playlist's segments, in order.
        /// </summary>
        public static string Rewrite(string text, string baseUrl, Func<string, string> relay, string quality, List<string> segments = null)
        {
            var lines = new List<string>();
            foreach (var raw in text.Replace("\r\n", "\n").Split('\n'))
            {
                var line = raw.TrimEnd('\r');
                var trimmed = line.Trim();
                if (trimmed.StartsWith("#", StringComparison.Ordinal))
                {
                    if (SubtitleMedia.IsMatch(trimmed))
                        continue;
                    if (trimmed.StartsWith("#EXT-X-STREAM-INF", StringComparison.Ordinal))
                        line = SubtitleGroup.Replace(line, "");
                    lines.Add(UriAttribute.Replace(line, m => "URI=\"" + relay(Resolve(baseUrl, m.Groups[1].Value)) + "\""));
                    continue;
                }
                if (trimmed.Length == 0)
                {
                    lines.Add(line);
                    continue;
                }
                var relayed = relay(Resolve(baseUrl, trimmed));
                segments?.Add(relayed);
                lines.Add(relayed);
            }
            if (segments != null && !text.Contains("#EXTINF"))
                segments.Clear(); // a master playlist lists renditions, not segments

            bool IsAudio(string l) => l.StartsWith("#EXT-X-MEDIA:", StringComparison.Ordinal) && l.IndexOf("TYPE=AUDIO", StringComparison.OrdinalIgnoreCase) >= 0;
            var original = lines.FirstOrDefault(l => IsAudio(l) && l.IndexOf("LANGUAGE=\"it", StringComparison.OrdinalIgnoreCase) < 0);
            if (original != null && lines.Count(IsAudio) > 1)
            {
                var kept = Regex.Replace(Regex.Replace(original, "DEFAULT=NO", "DEFAULT=YES", RegexOptions.IgnoreCase), "AUTOSELECT=NO", "AUTOSELECT=YES", RegexOptions.IgnoreCase);
                bool done = false;
                lines = lines.Where(l => !IsAudio(l) || (l == original && !done && (done = true))).Select(l => l == original ? kept : l).ToList();
            }

            var variants = new List<int>();
            for (int i = 0; i < lines.Count - 1; i++)
                if (lines[i].StartsWith("#EXT-X-STREAM-INF", StringComparison.Ordinal))
                    variants.Add(i);
            if (variants.Count > 1 && quality != "all")
            {
                int.TryParse(quality, NumberStyles.Integer, CultureInfo.InvariantCulture, out int limit);
                long Band(int i) => long.TryParse(Bandwidth.Match(lines[i]).Groups[1].Value, out var b) ? b : 0;
                int Class(int i) => QualityClass(int.TryParse(Width.Match(lines[i]).Groups[1].Value, out var w) ? w : 0);
                var allowed = variants.Where(i => limit <= 0 || Class(i) <= limit).ToList();
                var pool = allowed.Count > 0 ? allowed : new List<int> { variants.OrderBy(Band).First() };
                int best = pool.OrderByDescending(Band).First();
                foreach (var i in variants.Where(v => v != best).OrderByDescending(v => v))
                    lines.RemoveRange(i, 2);
            }
            return string.Join("\n", lines);
        }

        static readonly Regex SubtitleMedia = new Regex(@"^#EXT-X-MEDIA:.*TYPE=SUBTITLES", RegexOptions.Compiled);
        static readonly Regex SubtitleGroup = new Regex(@",SUBTITLES=""[^""]*""", RegexOptions.Compiled);

        static string Attribute(string line, string name)
            => Regex.Match(line, "[:,]" + name + "=\"([^\"]*)\"").Groups[1].Value;

        /// <summary>A master playlist's subtitle renditions, with absolute URLs.</summary>
        public static List<Subtitle> Subtitles(string master, string baseUrl)
            => master.Replace("\r\n", "\n").Split('\n').Where(l => SubtitleMedia.IsMatch(l) && Attribute(l, "URI").Length > 0)
                .Select(l => new Subtitle { Label = Attribute(l, "NAME"), Language = Attribute(l, "LANGUAGE"), Url = Resolve(baseUrl, Attribute(l, "URI")) })
                .ToList();

        /// <summary>Absolute URLs are kept exactly as written (tokens must not be re-encoded).</summary>
        public static string Resolve(string baseUrl, string url)
        {
            if (url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || url.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                return url;
            return new Uri(new Uri(baseUrl), url).AbsoluteUri;
        }
    }
}
