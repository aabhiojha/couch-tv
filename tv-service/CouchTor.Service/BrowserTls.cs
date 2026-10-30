using System.Net;
using System.Net.Http;
using System.Net.Security;

namespace CouchTor
{
    /// <summary>
    /// HTTP handlers whose TLS offer looks like a current browser's. The TV's .NET Core 3.1 offers 31 cipher suites,
    /// legacy ones included, and the sports stream hosts (strmd.st) refuse that fingerprint with 403 while accepting
    /// the same request from a modern client. Offering only the modern suites gets the same answer as a browser.
    /// </summary>
    static class BrowserTls
    {
        static readonly TlsCipherSuite[] Suites =
        {
            TlsCipherSuite.TLS_AES_256_GCM_SHA384, TlsCipherSuite.TLS_CHACHA20_POLY1305_SHA256, TlsCipherSuite.TLS_AES_128_GCM_SHA256,
            TlsCipherSuite.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384, TlsCipherSuite.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
            TlsCipherSuite.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384, TlsCipherSuite.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
            TlsCipherSuite.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256, TlsCipherSuite.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256,
            TlsCipherSuite.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384, TlsCipherSuite.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256,
        };

        /// <summary>
        /// The stream hosts drop about half of new connection attempts (SYN retransmits make a connect take 4-11 s):
        /// give up on a connect after 3 s so <see cref="Streams.Upstream"/> retries on a fresh one.
        /// </summary>
        public static HttpMessageHandler Handler() => new SocketsHttpHandler
        {
            ConnectTimeout = System.TimeSpan.FromSeconds(3),
            AllowAutoRedirect = true,
            AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            UseCookies = false,
            SslOptions = new SslClientAuthenticationOptions { CipherSuitesPolicy = new CipherSuitesPolicy(Suites) },
        };
    }
}
