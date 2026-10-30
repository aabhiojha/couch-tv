using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;

namespace CouchTor.Streams
{
    /// <summary>A whole upstream answer, read into memory.</summary>
    public sealed class Fetched
    {
        public int Status;
        public string ContentType = "";
        public byte[] Body = new byte[0];
        /// <summary>After redirects: relative playlist URLs resolve against this.</summary>
        public string Url;

        public string Text() => System.Text.Encoding.UTF8.GetString(Body);
    }

    /// <summary>HTTP client for the providers and the relay, with the hosts' quirks handled once.</summary>
    public sealed class Upstream
    {
        readonly HttpClient client;

        /// <summary>
        /// Time for one attempt to get response headers. A segment host occasionally stalls; waiting longer
        /// shows on the TV as a playback error after a seek, so give up and try once more instead.
        /// </summary>
        public TimeSpan AttemptTimeout = TimeSpan.FromSeconds(12);
        /// <summary>Time to read a buffered body once its headers arrived.</summary>
        public TimeSpan BodyTimeout = TimeSpan.FromSeconds(60);
        public long MaxBuffered = 64L * 1024 * 1024;
        /// <summary>
        /// Tries per request on a timeout, connection failure or 5xx. Some hosts drop about half of new connection
        /// attempts, so two failures in a row are common enough to need a third.
        /// </summary>
        public int Attempts = 3;

        public Upstream(HttpMessageHandler handler = null)
        {
            client = new HttpClient(handler ?? new HttpClientHandler
            {
                AllowAutoRedirect = true,
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
                UseCookies = false,
            }, disposeHandler: false)
            { Timeout = Timeout.InfiniteTimeSpan };
            client.DefaultRequestHeaders.ExpectContinue = false;
        }

        /// <summary>
        /// GET with <paramref name="headers"/>, returning once the response headers arrived (the caller disposes it).
        /// A timeout, failed connection or 5xx is retried (<see cref="Attempts"/>). A 403 to a request carrying Referer/Origin is retried without them:
        /// VidApi's segment host refuses the very headers its playlists require.
        /// </summary>
        public async Task<HttpResponseMessage> SendAsync(string url, IReadOnlyDictionary<string, string> headers, string range, CancellationToken token)
        {
            bool dropReferer = false;
            for (int attempt = 0; ; attempt++)
            {
                var request = new HttpRequestMessage(HttpMethod.Get, url);
                foreach (var h in headers ?? new Dictionary<string, string>())
                    if (!dropReferer || !IsRefererHeader(h.Key))
                        request.Headers.TryAddWithoutValidation(h.Key, h.Value);
                if (range != null)
                    request.Headers.TryAddWithoutValidation("Range", range);
                // Only the wait for headers is limited: the body of a streamed film may take an hour.
                var attemptCts = CancellationTokenSource.CreateLinkedTokenSource(token);
                attemptCts.CancelAfter(AttemptTimeout);
                HttpResponseMessage response;
                try
                {
                    response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, attemptCts.Token).ConfigureAwait(false);
                    attemptCts.CancelAfter(Timeout.Infinite);
                }
                catch (Exception e) when (attempt < Attempts - 1 && !token.IsCancellationRequested && (e is OperationCanceledException || e is HttpRequestException))
                {
                    continue;
                }
                catch (OperationCanceledException) when (!token.IsCancellationRequested)
                {
                    throw new TimeoutException("no answer from " + new Uri(url).Host + " in " + AttemptTimeout.TotalSeconds + " s");
                }
                int status = (int)response.StatusCode;
                if (status == 403 && !dropReferer && headers != null && headers.Keys.Any(IsRefererHeader))
                {
                    response.Dispose();
                    dropReferer = true;
                    attempt--; // not a failed attempt: the same request without the two headers
                    continue;
                }
                if (status >= 500 && attempt < Attempts - 1)
                {
                    response.Dispose();
                    continue;
                }
                return response;
            }
        }

        /// <summary>GET and read the whole body (playlists, segments, API answers).</summary>
        public async Task<Fetched> GetAsync(string url, IReadOnlyDictionary<string, string> headers, CancellationToken token)
        {
            using (var response = await SendAsync(url, headers, null, token).ConfigureAwait(false))
                return await ReadAsync(response, url, token).ConfigureAwait(false);
        }

        public async Task<Fetched> ReadAsync(HttpResponseMessage response, string url, CancellationToken token)
        {
            var length = response.Content.Headers.ContentLength;
            if (length > MaxBuffered)
                throw new InvalidDataException("upstream answer too large to buffer: " + length + " bytes");
            using (var cts = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                cts.CancelAfter(BodyTimeout);
                var body = new MemoryStream(length > 0 ? (int)length : 64 * 1024);
                using (var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (cts.Token.Register(() => stream.Dispose()))
                {
                    var buf = new byte[64 * 1024];
                    int n;
                    try
                    {
                        while ((n = await stream.ReadAsync(buf, 0, buf.Length, cts.Token).ConfigureAwait(false)) > 0)
                        {
                            body.Write(buf, 0, n);
                            if (body.Length > MaxBuffered)
                                throw new InvalidDataException("upstream answer too large to buffer");
                        }
                    }
                    catch (Exception e) when (cts.IsCancellationRequested && !token.IsCancellationRequested && (e is ObjectDisposedException || e is IOException || e is OperationCanceledException))
                    {
                        throw new TimeoutException("body from " + new Uri(url).Host + " took over " + BodyTimeout.TotalSeconds + " s");
                    }
                }
                return new Fetched
                {
                    Status = (int)response.StatusCode,
                    ContentType = response.Content.Headers.ContentType?.ToString() ?? "",
                    Body = body.ToArray(),
                    Url = response.RequestMessage?.RequestUri?.AbsoluteUri ?? url,
                };
            }
        }

        static bool IsRefererHeader(string name)
            => string.Equals(name, "Referer", StringComparison.OrdinalIgnoreCase) || string.Equals(name, "Origin", StringComparison.OrdinalIgnoreCase);
    }
}
