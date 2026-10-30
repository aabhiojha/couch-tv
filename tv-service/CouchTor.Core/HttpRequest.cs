using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace CouchTor
{
    public sealed class HttpRequest
    {
        public string Method;
        public string Target;
        public string Path;
        public List<KeyValuePair<string, string>> Query = new List<KeyValuePair<string, string>>();
        public Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public string Header(string name) => Headers.TryGetValue(name, out var v) ? v : null;

        public List<string> QueryAll(string key)
        {
            var list = new List<string>();
            foreach (var kv in Query)
                if (kv.Key == key)
                    list.Add(kv.Value);
            return list;
        }

        public const int MaxHeaderBytes = 16 * 1024;

        /// <summary>Reads one request head. Returns null if the connection closed first; throws <see cref="InvalidDataException"/> if malformed.</summary>
        public static async Task<HttpRequest> ReadAsync(Stream stream, CancellationToken token)
        {
            var buf = new byte[MaxHeaderBytes];
            int len = 0;
            while (true)
            {
                if (len == buf.Length)
                    throw new InvalidDataException("request head too large");
                int n = await stream.ReadAsync(buf, len, buf.Length - len, token).ConfigureAwait(false);
                if (n <= 0)
                {
                    if (len == 0)
                        return null;
                    throw new InvalidDataException("connection closed inside the request head");
                }
                int scanFrom = Math.Max(0, len - 3);
                len += n;
                for (int i = scanFrom; i + 3 < len; i++)
                    if (buf[i] == '\r' && buf[i + 1] == '\n' && buf[i + 2] == '\r' && buf[i + 3] == '\n')
                        return Parse(Encoding.ASCII.GetString(buf, 0, i));
            }
        }

        public static HttpRequest Parse(string head)
        {
            var lines = head.Split(new[] { "\r\n" }, StringSplitOptions.None);
            var parts = lines[0].Split(' ');
            if (parts.Length != 3 || !parts[2].StartsWith("HTTP/", StringComparison.Ordinal))
                throw new InvalidDataException("bad request line");
            var req = new HttpRequest { Method = parts[0].ToUpperInvariant(), Target = parts[1] };
            for (int i = 1; i < lines.Length; i++)
            {
                int colon = lines[i].IndexOf(':');
                if (colon <= 0)
                    continue;
                req.Headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
            }
            var target = req.Target;
            if (target.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            {
                int slash = target.IndexOf('/', 7);
                target = slash < 0 ? "/" : target.Substring(slash);
            }
            int q = target.IndexOf('?');
            req.Path = Unescape(q < 0 ? target : target.Substring(0, q), false);
            if (q >= 0)
            {
                foreach (var pair in target.Substring(q + 1).Split('&'))
                {
                    if (pair.Length == 0)
                        continue;
                    int eq = pair.IndexOf('=');
                    req.Query.Add(eq < 0
                        ? new KeyValuePair<string, string>(Unescape(pair, true), "")
                        : new KeyValuePair<string, string>(Unescape(pair.Substring(0, eq), true), Unescape(pair.Substring(eq + 1), true)));
                }
            }
            return req;
        }

        static string Unescape(string s, bool plusIsSpace)
        {
            try { return Uri.UnescapeDataString(plusIsSpace ? s.Replace('+', ' ') : s); }
            catch (UriFormatException) { return s; }
        }
    }
}
