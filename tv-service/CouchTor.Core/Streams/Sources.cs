using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace CouchTor.Streams
{
    /// <summary>A film, or one episode of a series, by TMDB id.</summary>
    public sealed class Media
    {
        public bool IsTv;
        public string TmdbId;
        public int Season, Episode;

        public override string ToString() => IsTv ? "tv " + TmdbId + " s" + Season + "e" + Episode : "movie " + TmdbId;
    }

    /// <summary>A playable upstream stream and the headers its host wants on every request.</summary>
    public sealed class Source
    {
        public string Url;
        public string Type = "hls"; // hls | mp4
        public string Quality = "unknown"; // "1080p", ...
        public IReadOnlyDictionary<string, string> Headers;
        public string ProviderId, ProviderName;
    }

    public interface IStreamProvider
    {
        string Id { get; }
        string Name { get; }
        /// <summary>Sources for <paramref name="media"/>; empty (not an exception) when the provider has none.</summary>
        Task<IReadOnlyList<Source>> FindAsync(Media media, CancellationToken token);
    }

    /// <summary>Asks every provider at once and answers as soon as it is worth it.</summary>
    public sealed class SourceFinder
    {
        readonly IReadOnlyList<IStreamProvider> providers;
        readonly LogRing log;

        // One provider can stall for its whole timeout while another answers in a second. Answer once any
        // provider has a source, after a grace for the others (VidApi, often the 1080p source, tends to land
        // about a second after VixSrc), and never later than the cap.
        public TimeSpan Grace = TimeSpan.FromSeconds(1.5);
        public TimeSpan Cap = TimeSpan.FromSeconds(15);

        public SourceFinder(IReadOnlyList<IStreamProvider> providers, LogRing log)
        {
            this.providers = providers;
            this.log = log;
        }

        /// <summary>Sources in provider order (the app prefers VixSrc's).</summary>
        public async Task<List<Source>> FindAsync(Media media, CancellationToken token)
        {
            var results = new IReadOnlyList<Source>[providers.Count];
            var found = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var all = Task.WhenAll(providers.Select(async (provider, index) =>
            {
                var started = DateTime.UtcNow;
                try
                {
                    var list = await provider.FindAsync(media, token).ConfigureAwait(false);
                    lock (results)
                        results[index] = list;
                    log.Add(provider.Name + " " + media + ": " + list.Count + " source(s) in " + Ms(started));
                    if (list.Count > 0)
                        found.TrySetResult(true);
                }
                catch (Exception e) when (!(e is OperationCanceledException) || !token.IsCancellationRequested)
                {
                    log.Add(provider.Name + " " + media + " failed after " + Ms(started) + ": " + e.GetBaseException().Message);
                }
            }));
            var cap = Task.Delay(Cap, token);
            await Task.WhenAny(all, cap, found.Task).ConfigureAwait(false);
            if (found.Task.IsCompleted && !all.IsCompleted)
                await Task.WhenAny(all, cap, Task.Delay(Grace, token)).ConfigureAwait(false);
            token.ThrowIfCancellationRequested();
            lock (results)
                return results.Where(r => r != null).SelectMany(r => r).ToList();
        }

        static string Ms(DateTime started) => (int)(DateTime.UtcNow - started).TotalMilliseconds + " ms";
    }
}
