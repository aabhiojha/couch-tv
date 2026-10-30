using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace CouchTor
{
    /// <summary>The last N log lines, served at <c>/log</c> (the TV has no other log).</summary>
    public sealed class LogRing
    {
        readonly Queue<string> lines = new Queue<string>();
        readonly int capacity;
        readonly Func<DateTime> clock;

        public LogRing(int capacity = 300, Func<DateTime> clock = null)
        {
            this.capacity = capacity;
            this.clock = clock ?? (() => DateTime.Now);
        }

        public void Add(string message)
        {
            var line = clock().ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture) + " " + message;
            lock (lines)
            {
                lines.Enqueue(line);
                while (lines.Count > capacity)
                    lines.Dequeue();
            }
        }

        public string Text()
        {
            var sb = new StringBuilder();
            lock (lines)
                foreach (var l in lines)
                    sb.Append(l).Append('\n');
            return sb.ToString();
        }

        public int Count { get { lock (lines) return lines.Count; } }
    }
}
