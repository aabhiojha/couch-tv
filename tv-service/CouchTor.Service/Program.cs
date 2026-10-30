using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Tizen.Applications;

namespace CouchTor
{
    /// <summary>Tizen service entry point: starts the HTTP API on :11470 (torrents and the trailer page) and the torrent engine.</summary>
    class App : ServiceApplication
    {
        public const int Port = 11470;
        static readonly LogRing Log = new LogRing(300);
        static TorrentEngine engine;
        static HttpService http;

        protected override void OnCreate()
        {
            base.OnCreate();
            var data = Current.DirectoryInfo.Data;
            // Off the Tizen main thread: its SynchronizationContext must not capture engine continuations.
            Task.Run(() => Start(data));
        }

        static void Start(string data)
        {
            try
            {
                LogPreviousCrash(data);
                LogPreviousRun(data);
                // The TV can kill the process without a trace: keep the log on disk so the next run can show it.
                new Thread(() =>
                {
                    var path = Path.Combine(data, "last.log");
                    while (true)
                    {
                        Thread.Sleep(5000);
                        try { File.WriteAllText(path + ".tmp", Log.Text()); File.Copy(path + ".tmp", path, true); } catch { }
                    }
                }) { IsBackground = true, Name = "log saver" }.Start();
                engine = new TorrentEngine(data, Log);
                http = new HttpService(engine, Log);
                http.Start(IPAddress.Any, Port);
                Log.Add("listening on :" + Port + ", .NET " + Environment.Version + ", " + Environment.ProcessorCount + " cpus, data " + data);
                _ = engine.StartAsync();
            }
            catch (Exception e)
            {
                Log.Add("start failed: " + e);
                Crash(data, e);
            }
        }

        protected override void OnTerminate()
        {
            Log.Add("terminating");
            try { engine?.ShutdownAsync().Wait(TimeSpan.FromSeconds(5)); } catch { }
            base.OnTerminate();
        }

        static void Crash(string data, object error)
        {
            try { File.WriteAllText(Path.Combine(data, "crash.txt"), DateTime.Now.ToString("s") + " " + error); } catch { }
        }

        static void LogPreviousRun(string data)
        {
            var path = Path.Combine(data, "last.log");
            try
            {
                if (!File.Exists(path))
                    return;
                var lines = File.ReadAllLines(path);
                Log.Add("previous run, last " + Math.Min(15, lines.Length) + " log lines:");
                foreach (var l in lines.Skip(Math.Max(0, lines.Length - 15)))
                    Log.Add("  | " + l);
            }
            catch { }
        }

        static void LogPreviousCrash(string data)
        {
            var path = Path.Combine(data, "crash.txt");
            try
            {
                if (File.Exists(path))
                {
                    Log.Add("previous run crashed: " + File.ReadAllText(path));
                    File.Delete(path);
                }
            }
            catch { }
        }

        static void Main(string[] args)
        {
            AppDomain.CurrentDomain.UnhandledException += (s, e) =>
            {
                Log.Add("unhandled: " + e.ExceptionObject);
                try { Crash(Application.Current.DirectoryInfo.Data, e.ExceptionObject); } catch { }
            };
            TaskScheduler.UnobservedTaskException += (s, e) =>
            {
                Log.Add("unobserved: " + e.Exception.GetBaseException().Message);
                e.SetObserved();
            };
            new App().Run(args);
        }
    }
}
