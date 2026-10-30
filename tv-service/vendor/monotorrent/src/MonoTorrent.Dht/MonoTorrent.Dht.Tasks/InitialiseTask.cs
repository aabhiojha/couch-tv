//
// InitialiseTask.cs
//
// Authors:
//   Alan McGovern alan.mcgovern@gmail.com
//
// Copyright (C) 2008 Alan McGovern
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
// 
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//


using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading.Tasks;

using MonoTorrent.Dht.Messages;

namespace MonoTorrent.Dht.Tasks
{
    class InitialiseTask
    {
        // Choose a completely arbitrary value here. If we have at least this many
        // nodes in the routing table we can consider it 'healthy' enough to allow
        // the state to change to 'Ready' so torrents can begin searching for peers
        const int MinHealthyNodes = 32;

        readonly List<Node> initialNodes;
        readonly DhtEngine engine;
        readonly TaskCompletionSource<object?> initializationComplete;

        static Node[]? BootstrapNodes { get; set; }

        public InitialiseTask (DhtEngine engine)
            : this (engine, Enumerable.Empty<Node> ())
        {

        }

        public InitialiseTask (DhtEngine engine, IEnumerable<Node> nodes)
        {
            this.engine = engine;
            initialNodes = new List<Node> (nodes);
            initializationComplete = new TaskCompletionSource<object?> ();
        }

        public Task ExecuteAsync ()
        {
            DhtEngine.MainLoop.CheckThread ();
            BeginAsyncInit ();
            return initializationComplete.Task;
        }

        async void BeginAsyncInit ()
        {
            // If we were given a list of nodes to load at the start, use them
            // Couch TV: query the saved nodes and the bootstrap routers at the same time (saved nodes are often
            // stale, and waiting for all their queries to time out first delayed the first lookup by minutes).
            try {
                var saved = initialNodes.Count > 0 ? SendFindNode (initialNodes) : Task.CompletedTask;
                Task routers;
                try {
                    if (BootstrapNodes is null)
                        BootstrapNodes = await GenerateBootstrapNodes ();
                    routers = SendFindNode (BootstrapNodes);
                } catch {
                    routers = Task.CompletedTask;
                }
                await Task.WhenAll (saved, routers);
            } catch {
            } finally {
                initializationComplete.TrySetResult (null);
            }
        }

        // Couch TV: router.bittorrent.com alone doesn't answer from every network (it didn't from the TV's).
        static readonly (string host, int port)[] BootstrapRouters = {
            ("router.bittorrent.com", 6881),
            ("router.utorrent.com", 6881),
            ("dht.transmissionbt.com", 6881),
            ("dht.libtorrent.org", 25401),
        };

        async Task<Node[]> GenerateBootstrapNodes ()
        {
            var lookups = BootstrapRouters.Select (async r => {
                try {
                    return (await Dns.GetHostAddressesAsync (r.host))
                        .Where (a => a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                        .Select (a => new IPEndPoint (a, r.port));
                } catch {
                    return Enumerable.Empty<IPEndPoint> ();
                }
            }).ToArray ();
            var endpoints = (await Task.WhenAll (lookups)).SelectMany (e => e).ToArray ();
            if (endpoints.Length == 0)
                throw new System.InvalidOperationException ("No DHT bootstrap router resolved");
            return endpoints
                .Select (t => new Node (NodeId.Create (), t))
                .ToArray ();
        }

        async Task SendFindNode (IEnumerable<Node> newNodes)
        {
            var activeRequests = new List<Task<SendQueryEventArgs>> ();
            var nodes = new ClosestNodesCollection (engine.LocalId);

            foreach (Node node in newNodes) {
                var request = new FindNode (engine.LocalId, engine.LocalId);
                activeRequests.Add (engine.SendQueryAsync (request, node));
                nodes.Add (node);
            }

            while (activeRequests.Count > 0) {
                var completed = await Task.WhenAny (activeRequests);
                activeRequests.Remove (completed);

                SendQueryEventArgs args = await completed;
                if (args.Response != null) {
                    if (engine.RoutingTable.CountNodes () >= MinHealthyNodes)
                        initializationComplete.TrySetResult (null);

                    var response = (FindNodeResponse) args.Response;
                    foreach (Node node in Node.FromCompactNode (response.Nodes)) {
                        if (nodes.Add (node)) {
                            var request = new FindNode (engine.LocalId, engine.LocalId);
                            activeRequests.Add (engine.SendQueryAsync (request, node));
                        }
                    }
                }
            }

            if (initialNodes.Count > 0 && engine.RoutingTable.NeedsBootstrap)
                await new InitialiseTask (engine).ExecuteAsync ();
        }
    }
}
