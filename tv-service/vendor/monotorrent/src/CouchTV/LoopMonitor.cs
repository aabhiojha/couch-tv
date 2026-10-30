// Couch TV addition: lets the TV service see inside MonoTorrent's main loops (the TV has no
// debugger or logs), and routes main-loop exceptions to the service log instead of stdout.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Text;

namespace MonoTorrent
{
    public static class LoopMonitor
    {
        static readonly List<(object loop, string name)> loops = new List<(object, string)> ();

        /// <summary>Last step the client engine's tick reached (breadcrumb for a stuck loop).</summary>
        public static volatile string Crumb = "";

        /// <summary>Called with every exception a main-loop task throws (the loop keeps running).</summary>
        public static Action<Exception>? Exception;

        internal static void Register (Client.MainLoop loop, string name)
        {
            lock (loops)
                loops.Add ((loop, name));
        }

        internal static void OnException (Exception ex)
            => Exception?.Invoke (ex);

        /// <summary>One line per loop: queue length, tasks run, and the task running now with how long it has run.</summary>
        public static string Describe ()
        {
            var sb = new StringBuilder ();
            lock (loops) {
                foreach (var (o, name) in loops) {
                    var loop = (Client.MainLoop) o;
                    long since = loop.BusySince;
                    var current = loop.Current;
                    sb.Append (name).Append (" tid ").Append (loop.ThreadId).Append (": queued=").Append (loop.QueueLength).Append (" executed=").Append (loop.Executed);
                    if (since != 0) {
                        var ms = (Stopwatch.GetTimestamp () - since) * 1000 / Stopwatch.Frequency;
                        sb.Append (" busy=").Append (ms).Append ("ms in ").Append (Name (current));
                    } else {
                        sb.Append (" idle");
                    }
                    sb.Append ('\n');
                }
            }
            sb.Append ("crumb: ").Append (Crumb).Append ('\n');
            return sb.ToString ();
        }

        /// <summary>The longest time any loop has been inside a single task, in ms (0 if all idle).</summary>
        public static long LongestBusyMs ()
        {
            long max = 0;
            lock (loops)
                foreach (var (o, _) in loops) {
                    long since = ((Client.MainLoop) o).BusySince;
                    if (since != 0)
                        max = Math.Max (max, (Stopwatch.GetTimestamp () - since) * 1000 / Stopwatch.Frequency);
                }
            return max;
        }

        [System.Runtime.InteropServices.DllImport ("libc", EntryPoint = "syscall")]
        static extern int Syscall (int number);

        /// <summary>The Linux thread id of the calling thread (matches /proc/self/task), or -1.</summary>
        public static int NativeThreadId ()
        {
            try {
                if (!System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform (System.Runtime.InteropServices.OSPlatform.Linux))
                    return -1;
                switch (System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture) {
                    case System.Runtime.InteropServices.Architecture.Arm: return Syscall (224);
                    case System.Runtime.InteropServices.Architecture.Arm64: return Syscall (178);
                    case System.Runtime.InteropServices.Architecture.X64: return Syscall (186);
                    case System.Runtime.InteropServices.Architecture.X86: return Syscall (224);
                }
            } catch {
            }
            return -1;
        }

        static string Name (Delegate? d)
        {
            if (d == null)
                return "?";
            var target = d.Target;
            // Async continuations: the target is the state machine box; its type names the async method.
            var t = target?.GetType ().FullName ?? d.Method.DeclaringType?.FullName;
            return t + "::" + d.Method.Name;
        }
    }
}
