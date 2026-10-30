using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace CouchTor
{
    /// <summary>
    /// Minimal JSON parser for the stream providers' small API answers: objects become
    /// <see cref="Dictionary{TKey,TValue}"/>, arrays <see cref="List{T}"/>, numbers <see cref="double"/>.
    /// </summary>
    public sealed class JsonReader
    {
        readonly string s;
        int i;

        JsonReader(string text) { s = text; }

        /// <summary>Throws <see cref="InvalidDataException"/> on malformed input.</summary>
        public static object Parse(string text)
        {
            var r = new JsonReader(text ?? "");
            var value = r.Value();
            r.Space();
            if (r.i != r.s.Length)
                throw new InvalidDataException("trailing data at " + r.i);
            return value;
        }

        /// <summary>The string at <paramref name="path"/> (object keys), or null if any step is missing or not a string.</summary>
        public static string Str(object json, params string[] path) => Get(json, path) as string;

        public static object Get(object json, params string[] path)
        {
            foreach (var key in path)
            {
                if (!(json is Dictionary<string, object> map) || !map.TryGetValue(key, out json))
                    return null;
            }
            return json;
        }

        void Space()
        {
            while (i < s.Length && char.IsWhiteSpace(s[i]))
                i++;
        }

        object Value()
        {
            Space();
            if (i >= s.Length)
                throw new InvalidDataException("unexpected end");
            switch (s[i])
            {
                case '{': return Map();
                case '[': return Array();
                case '"': return String();
                case 't': return Word("true", true);
                case 'f': return Word("false", false);
                case 'n': return Word("null", null);
                default: return Number();
            }
        }

        object Word(string word, object value)
        {
            if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0)
                throw new InvalidDataException("unexpected token at " + i);
            i += word.Length;
            return value;
        }

        Dictionary<string, object> Map()
        {
            var map = new Dictionary<string, object>();
            i++;
            Space();
            if (i < s.Length && s[i] == '}') { i++; return map; }
            while (true)
            {
                Space();
                if (i >= s.Length || s[i] != '"')
                    throw new InvalidDataException("expected a key at " + i);
                var key = String();
                Space();
                if (i >= s.Length || s[i] != ':')
                    throw new InvalidDataException("expected ':' at " + i);
                i++;
                map[key] = Value();
                Space();
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == '}') { i++; return map; }
                throw new InvalidDataException("expected ',' or '}' at " + i);
            }
        }

        List<object> Array()
        {
            var list = new List<object>();
            i++;
            Space();
            if (i < s.Length && s[i] == ']') { i++; return list; }
            while (true)
            {
                list.Add(Value());
                Space();
                if (i < s.Length && s[i] == ',') { i++; continue; }
                if (i < s.Length && s[i] == ']') { i++; return list; }
                throw new InvalidDataException("expected ',' or ']' at " + i);
            }
        }

        string String()
        {
            var sb = new StringBuilder();
            i++;
            while (i < s.Length)
            {
                char c = s[i++];
                if (c == '"')
                    return sb.ToString();
                if (c != '\\')
                {
                    sb.Append(c);
                    continue;
                }
                if (i >= s.Length)
                    break;
                char e = s[i++];
                switch (e)
                {
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'u':
                        if (i + 4 > s.Length)
                            throw new InvalidDataException("bad \\u escape at " + i);
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: sb.Append(e); break; // \" \\ \/
                }
            }
            throw new InvalidDataException("unterminated string");
        }

        double Number()
        {
            int start = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0)
                i++;
            if (start == i || !double.TryParse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
                throw new InvalidDataException("bad value at " + start);
            return d;
        }
    }
}
