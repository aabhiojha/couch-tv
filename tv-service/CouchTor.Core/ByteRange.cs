using System;
using System.Globalization;

namespace CouchTor
{
    /// <summary>A parsed HTTP <c>Range</c> header for one byte range.</summary>
    public struct ByteRange
    {
        public enum Kind { None, Satisfiable, Unsatisfiable }

        public Kind Result;
        public long Start, End; // inclusive

        public long Length => End - Start + 1;

        /// <summary>
        /// Parses <c>bytes=a-b</c>, <c>bytes=a-</c> and <c>bytes=-n</c> (the last n bytes) against a resource of
        /// <paramref name="length"/> bytes. A missing or malformed header, or a multi-range one, is <see cref="Kind.None"/>
        /// (serve the whole file with 200), as RFC 9110 allows.
        /// </summary>
        public static ByteRange Parse(string header, long length)
        {
            var none = new ByteRange { Result = Kind.None, Start = 0, End = length - 1 };
            if (string.IsNullOrWhiteSpace(header))
                return none;
            header = header.Trim();
            if (!header.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
                return none;
            var spec = header.Substring(6).Trim();
            if (spec.IndexOf(',') >= 0)
                return none;
            int dash = spec.IndexOf('-');
            if (dash < 0)
                return none;
            var first = spec.Substring(0, dash).Trim();
            var last = spec.Substring(dash + 1).Trim();
            var unsatisfiable = new ByteRange { Result = Kind.Unsatisfiable };

            if (first.Length == 0)
            {
                if (!TryNumber(last, out long suffix))
                    return none;
                if (suffix == 0 || length == 0)
                    return unsatisfiable;
                return new ByteRange { Result = Kind.Satisfiable, Start = Math.Max(0, length - suffix), End = length - 1 };
            }
            if (!TryNumber(first, out long start))
                return none;
            long end = length - 1;
            if (last.Length > 0)
            {
                if (!TryNumber(last, out end) || end < start)
                    return none;
                end = Math.Min(end, length - 1);
            }
            if (start >= length)
                return unsatisfiable;
            return new ByteRange { Result = Kind.Satisfiable, Start = start, End = end };
        }

        static bool TryNumber(string s, out long value)
        {
            value = 0;
            if (s.Length == 0 || s.Length > 18)
                return false;
            foreach (var c in s)
                if (c < '0' || c > '9')
                    return false;
            return long.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out value);
        }
    }
}
