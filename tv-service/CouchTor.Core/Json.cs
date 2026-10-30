using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace CouchTor
{
    /// <summary>Minimal JSON writer for the service's flat stats objects.</summary>
    public sealed class Json
    {
        readonly StringBuilder sb = new StringBuilder();
        bool first = true;

        public static Json Object() { var j = new Json(); j.sb.Append('{'); return j; }

        Json Key(string key)
        {
            if (!first) sb.Append(',');
            first = false;
            Str(sb, key);
            sb.Append(':');
            return this;
        }

        public Json Add(string key, long value) { Key(key).sb.Append(value.ToString(CultureInfo.InvariantCulture)); return this; }
        public Json Add(string key, double value)
        {
            Key(key);
            if (double.IsNaN(value) || double.IsInfinity(value)) sb.Append('0');
            else sb.Append(value.ToString("0.######", CultureInfo.InvariantCulture));
            return this;
        }
        public Json Add(string key, bool value) { Key(key).sb.Append(value ? "true" : "false"); return this; }
        public Json Add(string key, string value) { Key(key); if (value == null) sb.Append("null"); else Str(sb, value); return this; }
        public Json Raw(string key, string json) { Key(key).sb.Append(json); return this; }

        public override string ToString() => sb.ToString() + "}";

        public static void Str(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (var c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }
}
