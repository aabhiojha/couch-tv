# Torrent streaming server

Torrent sources from Stremio add-ons play through the service **on the TV** by default, at
`http://<TV LAN IP>:11470` (from `webapis.network.getIp()`). See
[TV torrent service](tv-torrent-service.md) for its build, installation and measurements. The app
checks `/heartbeat` at startup, tries to launch `CouchTor01.Service` if needed, and waits up to
10 seconds before falling back to another source. Settings > Sources shows **On this TV** and
its connection status. The TV service has no transcoding: DTS/TrueHD sources are excluded.

For desktop development, Stremio's official streaming server on the laptop is an optional override:
set `COUCH_SECRETS.torrentServer` in `web/js/secrets.js`, for example
`'http://192.168.1.34:11470'`. The override retains HLS audio transcoding. Without an override or
TV network API, desktop uses `http://127.0.0.1:11470`. Tracker entries from add-ons are passed as
repeated encoded `tr` query parameters on torrent URLs.

`./build.sh` runs desktop checks only. `./build.sh install` also runs `tv-service/build.sh install`, which
builds, signs, installs and starts the TV service; it skips the service with a message if
`~/.dotnet/dotnet` is missing.

The remaining notes describe the optional **laptop Stremio server**, including its extra HLS APIs.

Everything below was verified on 2026-10-20 with the legal Sintel torrent (Blender open movie,
`08ada5a7a6183aae1e09d831df6748d566095a10`), from the laptop. The TV hasn't been tested yet.

## How it runs

| | |
|---|---|
| Service | user service `couch-tv-torrents.service`, enabled, starts on boot (lingering is on) |
| Script | `~/tv-shinnagans/tv-remote/app/scripts/stremio-server.sh` (unit file next to it) |
| Server | `server.js` **v4.21.1** from `https://dl.strem.io/server/v4.21.1/desktop/server.js`, the version stremio-service v0.1.22 ships; pinned by SHA-256 `405eb494…385930f`. `/settings` reports `serverVersion` 4.21.0 |
| Runtime | node 24 (fnm default), system `/usr/bin/ffmpeg` and `ffprobe` (ffmpeg 8). At start it tests hardware encoders; this laptop passes `nvenc-linux` |
| Files | `~/tv-shinnagans/tv-remote/app/.local-provider/stremio-server/`: `server.js`, `data/server-settings.json`, `data/stremio-cache/<infoHash>/` |
| Cache | 10 GB (`cacheSize` 10737418240, rewritten on every start). Whenever a torrent starts, the server deletes the least recently used cached files above 10 GB (or above free disk space), skipping torrents in use. A torrent with no open stream for 2 minutes is dropped (its cached pieces stay) |
| Logs | `journalctl --user -u couch-tv-torrents.service` (request paths include info hashes) |

```sh
systemctl --user status couch-tv-torrents.service
systemctl --user restart couch-tv-torrents.service
curl -fsS http://192.168.1.34:11470/heartbeat          # {"success":true}
```

The script sets `NO_CORS=1` (CORS on every route), `NO_HTTPS_SERVER=1` (no `:12470` endpoint, which
fetches a certificate from api.strem.io) and `CASTING_DISABLED=1` (no DLNA/Chromecast discovery).

**No auth, LAN only.** The server listens on every interface, so the script preloads
`scripts/stremio-server-lan.cjs`, which drops connections from anything but loopback and
`192.168.1.0/24` (verified: a request from the Tailscale address is reset). Update that file if
the home network changes. ufw's default input policy here is DROP and its rules need root to read;
if the TV can't connect, allow the port: `sudo ufw allow from 192.168.1.0/24 to any port 11470 proto tcp`.

## API

`S = http://192.168.1.34:11470`, `IH` = the 40-hex info hash (any case), `IDX` = the file index.

| What | Request | Verified response |
|---|---|---|
| Stream a file | `GET S/IH/IDX` | `206` for a Range request (`Accept-Ranges: bytes`, `Content-Range`, `Content-Type: video/mp4`); `200` without Range. The first request adds the torrent and waits for its metadata |
| …by file name | `GET S/IH/Sintel.mp4` | `206`, same file |
| …guess the file | `GET S/IH/-1` | `206`; picks the main video file (index 5 for Sintel) |
| File list + guess | `POST S/IH/create` with JSON `{"guessFileIdx":{}}` | stats object with `files: [{name, length, …}]` and `guessedFileIdx` |
| File stats | `GET S/IH/IDX/stats.json` | `peers`, `unchoked`, `swarmSize`, `downloaded`, `uploaded` (bytes), `downloadSpeed` (bytes/s), `streamName`, `streamLen`, `streamProgress` (0–1 of that file) |
| Torrent stats | `GET S/IH/stats.json` | the same without the `stream*` fields, plus `files`, `wires`, `sources` |
| All torrents | `GET S/stats.json` | `{ IH: stats, … }` |
| Remove a torrent | `GET S/IH/remove` | `{}`; stops the engine (cached pieces stay until trimmed) |
| HLS, short form | `GET S/IH/IDX/hls.m3u8` | HLS master playlist (fMP4 segments), audio limited to 2 channels |
| HLS, full form | `GET S/hlsv2/ID/master.m3u8?mediaURL=<encoded S/IH/IDX>&videoCodecs=h264&audioCodecs=aac&maxAudioChannels=2` | HLS master playlist; `ID` is any id you choose |
| Probe | `GET S/hlsv2/probe?mediaURL=<encoded url>` | `{format, streams: [{track, codec, channels, width, height, …}]}` |
| Transcoders | `GET S/hlsv2/status`, `GET S/hlsv2/ID/destroy` | running converters with their ffmpeg arguments; stop one |
| Settings | `GET S/settings`; `POST S/settings` with JSON values | `{options, values: {cacheSize, serverVersion, …}, baseUrl: "http://192.168.1.34:11470"}`; POST answers `{"success":true}` and saves |
| Health | `GET S/heartbeat` | `{"success":true}`. Don't use `GET S/`: it is a `307` redirect to app.strem.io |

**Sintel:** `fileIdx` **5** is `Sintel.mp4` (129,241,752 bytes). The other files are 9 `.srt`
subtitles (0–4, 6–9) and `poster.jpg` (10).

**fileIdx unknown.** Add-ons like Torrentio usually send `fileIdx`. Without it, use `S/IH/-1` (the
server's own guess), or `POST S/IH/create` with `{"guessFileIdx":{}}` to see the file list and
`guessedFileIdx` first.

**Range before the download finishes.** With 3 % of Sintel downloaded, `Range: bytes=0-1048575`
answered `206` with an MP4 header, and `Range: bytes=103393401-104442000` (80 %) answered `206`
with 1,048,600 bytes of real data within about 2 s; the server fetches the needed pieces first.
Stats during that test: 17 peers, 6.3 MB downloaded, 1.26 MB/s.

### HLS transcode

This is the endpoint Stremio's own players use for files they can't play directly. The server
probes the file, **copies** streams the client can decode and re-encodes only the rest, then
serves an fMP4 HLS master playlist with separate `video0.m3u8` and `audio0.m3u8` media playlists
and `video0/init.mp4`, `video0/segmentN.m4s` (relative URLs, so the short form works as is).

- Short form `S/IH/IDX/hls.m3u8` always passes `maxAudioChannels=2`. With Sintel (H.264, 6-channel
  AAC) it ran `-c:v copy` and `-c:a aac` to stereo, so DTS or TrueHD audio comes out as stereo AAC.
- Full form query options: `mediaURL` (required), `videoCodecs` and `audioCodecs` (repeat for
  several; codecs not listed are re-encoded), `maxAudioChannels`, `maxWidth`, `forceTranscoding=1`.
- 103 video and 217 audio segments for Sintel's 14:48; init segments and `segment1`/`segment2`
  decoded with ffprobe as H.264 1024×436 and AAC stereo.
- One transcode at a time (`transcodeConcurrency` 1): opening a second one stops the first. Idle
  ones stop after 2 minutes.

## CORS

With `NO_CORS=1`, every response to a request with an `Origin` header (including `Origin: null`)
carries `Access-Control-Allow-Origin: *`; requests without `Origin` get no CORS headers.
Preflight (`OPTIONS`) answers `200` with `Allow-Methods: POST, GET, OPTIONS` and echoes the
requested headers (e.g. `range`).

| Response | `Access-Control-Allow-Origin` |
|---|---|
| `S/IH/IDX` stream (`206`) | `*` |
| `S/IH/IDX/stats.json`, `S/IH/stats.json`, `S/stats.json` | `*` |
| `S/IH/IDX/hls.m3u8`, its segments, `S/hlsv2/…` | `*` (without `NO_CORS`: none, except for Stremio's own origins) |
| `S/settings`, `S/heartbeat` | `*` (without `NO_CORS`: none) |

**Torrentio** (`https://torrentio.strem.fun/stream/movie/tt0133093.json`, The Matrix): `200`,
`access-control-allow-origin: *` (also for `Origin: null`), preflight `204` allowing GET,
`cache-control: max-age=3600`, 113 streams. `manifest.json` also sends `*`. **The TV can fetch the
add-on directly**; no relay is needed.
