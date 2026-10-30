using System;
using System.IO;
using System.Linq;
using System.Text;

namespace CouchTor
{
    /// <summary>Per-thread kernel state from /proc/self/task: the only way to see a stuck thread on the TV.</summary>
    static class ProcThreads
    {
        public static string Describe()
        {
            var sb = new StringBuilder();
            try
            {
                foreach (var dir in Directory.GetDirectories("/proc/self/task").OrderBy(d => d.Length).ThenBy(d => d))
                {
                    var tid = Path.GetFileName(dir);
                    var comm = Read(dir + "/comm").Trim();
                    var stat = Read(dir + "/stat");
                    // Fields after the ")" of comm: state ... utime(14) stime(15)
                    var rest = stat.Substring(stat.LastIndexOf(')') + 2).Split(' ');
                    var state = rest.Length > 0 ? rest[0] : "?";
                    long ticks = rest.Length > 12 ? long.Parse(rest[11]) + long.Parse(rest[12]) : 0;
                    var wchan = Read(dir + "/wchan").Trim();
                    var syscall = Read(dir + "/syscall").Trim();
                    var sc = syscall.Split(' ');
                    sb.Append(tid).Append(' ').Append(comm).Append(' ').Append(state).Append(" cpu ").Append(ticks)
                      .Append(" wchan ").Append(wchan).Append(" syscall ").Append(sc.Length > 0 ? sc[0] : "?");
                    if (sc.Length > 2)
                        sb.Append(' ').Append(sc[1]).Append(' ').Append(sc[2]);
                    sb.Append('\n');
                }
            }
            catch (Exception e) { sb.Append("threads: ").Append(e.Message).Append('\n'); }
            return sb.ToString();
        }

        static string Read(string path)
        {
            try { return File.ReadAllText(path); }
            catch (Exception e) { return "(" + e.GetType().Name + ")"; }
        }
    }
}
