# Torrent service on the TV

The TV streams torrents itself: **`CouchTor01.Service`**, a Tizen .NET service app built from
[`tv-service/`](../tv-service), downloads with MonoTorrent and serves files over HTTP on
**port 11470** of the TV's LAN IP, with the same paths and fields as the Stremio server
([torrent-server.md](torrent-server.md)), so the app keeps one code path. The laptop server is now only
an optional override.

Everything here was measured on the TV (UA55AU7700, Tizen 6.0, armv7, .NET Core 3.1.3, at
192.168.1.6) from the laptop with `curl`, on 2026-10-21, with the legal Ubuntu 24.04.4 desktop ISO
(`01c137287d6f0ed05a56742dae794f632c79ff3d`, 6,655,619,072 bytes, 256 KiB pieces, by magnet).

## Build, install, start

| | |
|---|---|
| Build + sign | `tv-service/build.sh` → `tv-service/out/CouchTor01-1.0.0.tpk`, signed with the `couch` profile |
| …and install + start | `tv-service/build.sh install` (kills the running service first) |
| Laptop tests | `tv-service/build.sh test` (xunit on net8.0: Range parsing, HTTP layer, cache eviction, address filter) |
| Start by hand | `~/tizen-studio/tools/sdb -s 192.168.1.33:26101 shell 0 execute CouchTor01.Service` |
| Stop | `~/tizen-studio/tools/sdb -s 192.168.1.33:26101 shell 0 kill CouchTor01.Service` |
| Uninstall | `~/tizen-studio/tools/ide/bin/tizen uninstall -p CouchTor01.Service -s 192.168.1.33:26101` (with the package id `CouchTor01` the CLI says "package is not exist"; the app id works) |
| Health | `curl http://192.168.1.33:11470/heartbeat` → `{"success":true}` |
| Log | `curl http://192.168.1.33:11470/log` (last 300 lines; the TV has no other log) |
| Internals | `curl http://192.168.1.33:11470/debug` (engine loops, thread pool, disk queue, DHT, trackers, cache, threads) |
| Measurements | `tv-service/tools/measure.sh speed|cache|cold|refhttp` (the numbers below) |

Env for `build.sh`: `DOTNET` (default `~/.dotnet/dotnet`, SDK 8), `TIZEN_STUDIO` (`~/tizen-studio`),
`TV` (`192.168.1.33:26101`), `PROFILE` (`couch`). The app starts the service with
`tizen.application.launch('CouchTor01.Service')` (Module A).

## API

As in the contract (CORS `*` on every response, LAN and loopback clients only, anything else is
dropped without an answer):

| Request | Response |
|---|---|
| `GET /heartbeat` | `{"success":true}` |
| `GET /<infoHash>/<fileIdx>[?tr=<url>…]` | the file: `206` for `Range: bytes=a-b`, `a-`, `-n`; `200` without Range; `416` past the end. `-1` = the largest video file. A new GET for the same file ends the previous one's connection; `HEAD` doesn't. `tr` trackers of later requests are added to a running torrent. A client that stops reading for 60 s is disconnected |
| `GET /<infoHash>/<fileIdx>/stats.json` | `{"peers","downloadSpeed","uploadSpeed","downloaded","uploaded","state","error","name","streamLen","streamProgress","streamName"}` |
| `GET /<infoHash>/stats.json` | the same without `stream*`; `404` for an unknown torrent |
| `GET /<infoHash>/remove` | `{}`; stops the torrent, deletes its cached pieces and metadata |
| `GET /stats.json` | `{ <infoHash>: stats, … }` |
| `GET /log` | `text/plain`, last 300 lines |
| `GET /trailer.html?v=<YouTube id>` | the app's trailer player (YouTube refuses `file://` pages) |
| `GET /debug` | `text/plain` diagnostics (not part of the contract). `?cacheCap=<bytes>` overrides the cache cap (0 = automatic), for the eviction test |

`state` is `metadata`, `downloading`, `error`, or **`stopped`** (added: a torrent with no stream for
2 minutes). A stream request waits up to 120 s for metadata, then answers `504`.

## What the spike's freeze was

**Cause: a blocking `Socket.Connect` in MonoTorrent's netstandard builds, disposed from the engine's
main loop.** Not storage: preallocation was ruled out first.

1. The TV runs .NET Core 3.1, so NuGet gives it MonoTorrent's **netstandard2.1** assembly. In that
   build `SocketConnector.ConnectAsync` is a workaround for a .NET Framework 4.7.2 bug: it hops to a
   thread-pool thread and calls the **synchronous** `socket.Connect()` (the net5+/net6 builds the
   laptop uses connect asynchronously).
2. A connect to an unreachable peer (most peers in a public swarm) then blocks that pool thread for
   the kernel's SYN retry time, about 2 minutes.
3. Every engine tick, `ConnectionManager.CancelPendingConnects` disposes the sockets whose connect
   took longer than `ConnectionTimeout` (10 s). It does that **on the engine's main loop**, and on
   Linux disposing a socket while a blocking call is running on it waits for that call to return.
4. So the main loop sleeps for up to ~2 minutes in the middle of a tick. Each pass repeats it with
   the next stuck connect. Every counter (updated by ticks), every piece request, and `StopAsync`
   (which queues onto the main loop) wait behind it. That gives "counters frozen, HTTP still
   answering, remove blocks > 90 s". It happened 0.4–4 MB in because that's when the first
   connects to dead peers time out.

Evidence (spike code plus instrumentation, run 1 in the commit history): the MonoTorrent main loop was
inside one tick (`MainLoop.QueueTimeout` callback) for **109.9 s** with **1,324 tasks queued**; the
breadcrumb in that tick was `CancelPendingConnects`; `/proc/self/task/<loop tid>/stat` showed the
loop thread **sleeping** (state `S`, CPU time not increasing), so it was blocked, not spinning;
**17 thread-pool workers** were busy (the blocked connects). The disk and DHT loops were idle, the
disk write queue empty. What was ruled out first:

| Suspect | Test on the TV | Result |
|---|---|---|
| Full-size file preallocation | 6 GiB `SetLength` + 64 MiB written at 3 GiB in the data dir | 1 ms and 313 ms; free space dropped 64 MiB (sparse); not it |
| stdout pipe filling (the loop logs exceptions with `Console.WriteLine`) | 2 MB to stdout and to stderr | both pipes drained, no blocking; not it |
| Awaits resuming on the engine thread | (the spike's own test) | not it |

**Fix** (vendored MonoTorrent, `tv-service/vendor/monotorrent`): the synchronous connect is only
compiled for net472, so .NET Core 3.1 uses `ConnectAsync` with `SocketAsyncEventArgs`; and
`CancelPendingConnects` disposes connections on the thread pool, so a slow close can never stall the
loop again. With the fix the loop stays idle between ticks and the thread pool at 1 busy worker during
downloads (`/debug`). A watchdog logs `WATCHDOG engine loop stuck …` with the loop's current task and
the thread table if any loop task takes more than 5 s.

## Other changes to MonoTorrent 3.0.2

MonoTorrent is vendored as source (MIT, one `MonoTorrent.dll`), so these could be patched; every
change is marked `Couch TV` in the code and is its own commit (`git log -- tv-service/vendor`).

- **Read-ahead** (`StreamingPieceRequester`): with `ReadAheadBytes` set (64 MiB), only pieces in
  [read position, read position + 64 MiB) are requested, in order, with each peer's full request
  pipeline (MonoTorrent sizes it by the peer's speed: 8 + 1 per 10 KB/s). Upstream allowed 2–3
  outstanding 16 KiB requests per peer for that range and spent the rest on random rarest-first pieces
  anywhere in the torrent: 600 KB/s, and twice as many bytes downloaded as read. The piece being read
  and the next can still be requested from up to 3 peers at once, so one slow peer can't stall playback.
- **Trackers**: every magnet tracker is its own tier, so all are announced to at once. Upstream put
  them in one tier, which only moves to the next tracker when the current one fails, and an open tracker
  that answers with zero peers counts as success. The magnet's trackers are also kept when the metadata
  comes from the cache.
- **DHT bootstrap**: `router.bittorrent.com`, MonoTorrent's only bootstrap node, never answered from
  the TV's network (nor the laptop's); added `router.utorrent.com`, `dht.transmissionbt.com`,
  `dht.libtorrent.org:25401`, and bootstrap from them as well when the saved routing table is stale.
- Engine kept running with no torrent (`StartAndKeepRunningAsync`), so DHT is up before the first
  request; hooks to forget evicted pieces and restore cached ones; `LoopMonitor` diagnostics.

## Storage: the bounded piece cache

The data dir has ~1.7 GB free of 3.9 GB and a movie is 1–10 GB, so files are never stored whole.
`PieceStore` replaces MonoTorrent's disk writer:

- One file per piece in `data/cache/<infoHash>/<piece>`. A piece is complete when its hash passed **and**
  all its blocks are on disk (MonoTorrent can pass the hash before the last blocks leave its write
  queue); completions are appended to `data/cache/<infoHash>/done`, so after a restart the complete
  pieces are marked downloaded again without re-hashing, and partial ones are deleted.
- **Cap** `min(1 GiB, free space − 400 MiB)`, with the cache's own bytes counted as free. Before every
  write, complete pieces are evicted least recently used first, skipping the window of every open stream
  (16 MiB behind to 64 MiB + 16 MiB ahead of the read position) and pieces still downloading. Evicted
  pieces are marked missing in MonoTorrent and downloaded again when read. A write that would take free
  space below 400 MiB with nothing left to evict fails (the torrent errors) instead.
- A torrent with no open stream for 2 minutes stops (its complete pieces stay until evicted; partial
  ones are deleted). `remove` deletes its pieces and cached metadata.
- `data/engine/`: MonoTorrent's metadata cache (`metadata/<hash>.torrent`, so a known torrent starts
  without fetching metadata) and the DHT routing table `dht_nodes.cache` (saved every minute when it has ≥ 16 nodes, and on
  exit, loaded at start).

## Other behaviour

- Upload capped at 64 KB/s for the whole engine; 100 connections, 40 half-open with a 5 s connect timeout; no UPnP, no LPD. While a torrent has no metadata or < 8 peers it asks the DHT again every 10 s.
- Built-in trackers: opentrackr (UDP and HTTP), open.demonii.com, open.stealth.si, tracker.torrent.eu.org,
  exodus.desync.com, explodie.org, tracker.openbittorrent.com, opentracker.io, tracker.dler.org, plus every
  `tr` of the request.
- The HTTP server has its own accept thread; engine trouble can't stop `/heartbeat`.
- An unhandled exception is written to `data/crash.txt` and shown in `/log` after the restart.

## Measurements

All with `tv-service/tools/measure.sh` from the laptop (192.168.1.34, Wi-Fi) against the TV, Ubuntu by
magnet only. Reference bytes: sha256 of the same ranges of the ISO from releases.ubuntu.com (HTTP
Range; `measure.sh refhttp`). The laptop Stremio server answered 0 bytes for this torrent while it was
busy with another stream, so it wasn't used. "First byte" counts from the request; MB/s is
bytes / (total − first byte). Times are 2026-10-21.

### 1. No stall: 100 MB from offset 0 (target ≥ 1 MB/s from first byte, three runs)

| When (build) | First byte | Total | MB/s | Bytes |
|---|---|---|---|---|
| 09:45 (465dcf6) | 13.3 s | 41.0 s | 3.78 | 100 MB |
| 10:37 (7db4ef8) | 1.0 s | 36.7 s | 0.98 | **aborted at 36.7 MB**: cache restore bug, fixed in 4da4f97 |
| 10:38 (7db4ef8) | 19.4 s | 55.5 s | 2.77 | match |
| 10:39 (7db4ef8) | 10.6 s | 38.3 s | 3.61 | match |
| 10:56 (4da4f97, cache test) | 34.5 s | 64.5 s | 3.33 | match |
| 15:48 (e4aee50) | 47.7 s | 133.6 s | 1.16 | match |
| 15:50 (e4aee50) | — | 120 s | — | **504, no metadata**: torrent re-added < 1 s after `/remove`, no peers for 2 min; `measure.sh` now waits 15 s |
| 15:52 (e4aee50) | 10.0 s | 59.8 s | 2.01 | match |
| 15:59 (e4aee50, cache test) | 48.2 s | 75.6 s | 3.65 | **wrong bytes**: see 3 |

Every run that delivered all its bytes ran at ≥ 1.16 MB/s, up to 3.78 MB/s (the laptop's Stremio server:
2.7 MB/s in the spike). The freeze never came back: engine loop idle between ticks, ≤ 6 busy pool
workers, no watchdog report. At 16:00 the swarm gave ~10 MB/s with 15 peers. **Not met:** no session has
three consecutive clean runs, and the 15:59 run served wrong bytes (fix 38bb62f, not yet run on the TV).

### 3. Bounded storage (0, 3 GiB, 5.5 GiB, then 0 again; 100 MB each)

| | 10:56, cap automatic (1,024 MiB) | 15:59, cap 256 MiB (`/debug?cacheCap=`) |
|---|---|---|
| offset 0 | 3.33 MB/s, **match** | 3.65 MB/s, **mismatch** (zeros from unwritten blocks; 38bb62f) |
| offset 3 GiB | 5.82 MB/s, match | 7.16 MB/s, match |
| offset 5.5 GiB | 5.66 MB/s, match | 8.45 MB/s, match |
| offset 0 again | 18.1 MB/s (from cache), match | **stopped at 86 MB: the service process died** |
| max data dir | 443 MB | 257 MiB (cap + metadata and logs) |
| min free | 1,256 MB (floor 400) | 1,443 MB |
| evicted | 0 pieces | 1,175 pieces |

After `/remove`, free space returned to 1,699 MB both times. A restart keeps the cache: 350 MB read,
service restarted, same 350 MB read again in 30.6 s with identical sha256 (all 1,494 pieces restored).
**Pending:** the 256 MiB run again with 38bb62f, including the re-read after eviction.

### 4. Fast start: first byte after a service restart (target ≤ 20 s)

Torrent removed (no metadata, no pieces), service killed and started, `GET -r 0-0`; the heartbeat
answers about 1 s after the start.

| Build | Runs |
|---|---|
| 4da4f97 (11:19) | 50.4 s, 54.3 s, 34.1 s |
| + DHT lookups (11:31, one run) | 16.0 s |
| e4aee50 (15:54) | 35.3 s, **12.7 s**, 49.2 s |

**Not met** (1 of 3 within 20 s). Trackers return ~110 Ubuntu peers within 3 s, but most are dead, and
the DHT from this network is thin: `router.bittorrent.com` doesn't answer; after a restart the table
needs 30–75 s to reach Ready, and holds 13–51 nodes. Metadata arrives ~4 s after the first live peer.
When the torrent was played before (metadata cached), the first byte comes in about 1 s.

### 5. Idle stop, upload cap, crashes

- Idle stop: seen once in the log (09:31:46, stream ended → "idle for 2 min, stopping" 1 s later, 2 min
  after the request). **No dedicated test yet.**
- Upload stayed at 0–14 KB/s in every log line (cap 64 KB/s).
- **The service doesn't come back by itself after a crash.** A deliberate crash (since removed) left it
  down for 16 min, both with the manifest's `auto-restart="true"` and with a self-launching
  `AlarmManager` alarm (needs `background-category`, otherwise `NotPermittedApp`). Recovery is the app's
  job: it relaunches `CouchTor01.Service` when `/heartbeat` fails before each torrent play. A crash is
  recorded in `data/crash.txt` and the last log lines in `data/last.log`, both shown in `/log` on the
  next start.
- **Unexplained:** the process died twice during fast downloads (10:50 during the 5.5 GiB read; 16:00 at
  ~10 MB/s), with no managed exception, a 48 MB working set and ≤ 17 MB GC heap. The likely suspect is the
  TV killing a busy background app, not proven. `/debug` now shows process CPU to check this.
- The TV went into standby several times during testing (09:55, 11:35, 16:02). The service survived one
  standby (09:55–10:36).

