# Sources

TMDB supplies the catalog. With nothing configured, films and episodes come from the stream server inside the TV
service (`tv-service/CouchTor.Core/Streams/`, which finds streams on public sites) and from the Torrentio add-on;
live sports come from PPV and iptv-org's free sports channels. You can replace or add to these in
`web/js/secrets.js` (copy `web/js/secrets.example.js`):

| Setting | What it is |
|---|---|
| `addons` | Stremio add-on URLs. Torrent results play through the TV's torrent engine ([torrent-server.md](torrent-server.md)), http ones directly. |
| `provider` | A stream server for films and episodes, speaking the API below: an [OMSS](https://github.com/omss-spec/omss-spec) server you run, such as a self-hosted [CinePro Core](https://github.com/cinepro-org/core). |
| `playlists` | M3U playlists; their cricket and football channels appear on the Sports screen. Defaults to iptv-org's free sports channels. |
| `sportsRelay` | A server for the Sports screen's schedule, speaking the [sports API](#sports-relay) below. |

`addons` defaults to Torrentio and `provider` to the TV service's stream server. The app side of the stream
server is `web/js/pstream.js` (`PStream.scrape`, `PStream.ping`).

## API the app expects

### `GET /`

Health check. Any `2xx` within 4 seconds counts as connected.

### Sources for a title

```
GET /v1/movies/{tmdbId}
GET /v1/tv/{tmdbId}/seasons/{season}/episodes/{episode}
```

```json
{ "sources": [
  { "type": "hls", "url": "http://192.168.1.10:8788/v1/proxy?data=…", "provider": { "id": "example" } }
] }
```

The app keeps only sources that are `hls` or `mp4` **and** whose URL starts with
`<PROVIDER>/v1/proxy?`, so it never plays an unrelayed upstream URL. It rewrites the path to
`/v1/proxy.m3u8?…` so AVPlay treats the stream as HLS. Sources are tried in the order the server lists them.

### Renditions

```
GET /v1/proxy.m3u8?…&quality=all    → master playlist with every rendition
GET /v1/proxy.m3u8?…&quality=720    → only that rendition
```

The app reads `RESOLUTION=WxH` from the `quality=all` playlist and classes each rendition by
**width**, so a 1920×800 scope film counts as 1080p: ≥3800 → 2160, ≥1900 → 1080, ≥1260 → 720,
≥840 → 480, else 360. The relay must use the same classes when it serves `quality=N`.

## How a source is chosen

`PStream.scrape(item, video, quality, exclude)`:

1. Fetch the sources and drop any in `exclude` (sources that already failed this session).
2. Read every source's renditions in parallel. A source whose playlist can't be read still counts.
3. **Best available**: the source with the highest rendition. **A fixed quality**: the first
   source (in the server's order) whose best rendition at or below that quality is the highest.
4. Return `{ url, qualities, source, remaining }`. `remaining` tells the player whether another
   source is left to try if this one fails.

Errors shown to the user: "Can't reach the stream server" (network error), "Provider HTTP n",
"No stream found for this title", and "No other stream worked for this title" (every source
failed).

## Writing a stream server

Any server works if it implements the endpoints above
and serves relayed URLs under its own `/v1/proxy`. Make sure it allows requests from the TV's IP,
and remember the TV can't add custom request headers to HLS segment requests: the relay has to
add them.

## Sports relay

By default the TV's own service is the sports relay. It loads PPV's schedule (`api.ppv.st/api/streams`, cricket
and football only) and resolves each stream on the TV. To do that it runs the embed page's WebAssembly
(`gasm.wasm`) in an interpreter, with no browser, and then relays the HLS with the headers the CDN wants. PPV's
stream links only play from the IP that resolved them, which is why this happens on the TV
(`tv-service/CouchTor.Core/Sports/PpvResolver.cs`). Streamed, the earlier source, closed on 2026-11-04. The laptop
relay (`tools/live-relay.py`, which needs headless Chrome) is no longer needed.

To use another relay instead, set `sportsRelay`, or configure a `…/live.m3u` playlist from that relay's server.
The Sports screen reads `/sports.json` from it:

```json
{ "providers": [{ "name": "…", "status": "ok", "updatedAt": 0 }],
  "items": [{ "id": "…", "title": "…", "sport": "cricket", "kind": "event", "startsAt": 0,
              "streams": [{ "url": "http://…/play.m3u8", "label": "Main", "language": "en" }] }] }
```

`status` is `ok`, `stale` or `unavailable`. `kind` is `event` (with `startsAt` and an optional `endsAt`, in ms)
or `channel`; `thumb` is optional. Each stream `url` is an http(s) stream the TV plays directly.
`Live.readCatalog` drops anything else. The app fetches it at most once a minute and keeps the last good
catalog, marked stale, for six hours.

`GET /sports/health[?test=1]` is optional and feeds Settings › Sports streams; without it that row says the
relay is down.

`GET /sports/board?sport=soccer|cricket&date=YYYYMMDD` is optional too. It returns ESPN's scoreboard for that
(US Eastern) day, cut to the fields the Sports guide reads. The TV's own service has it, and keeps each board
for a minute. Without it the app asks ESPN directly.
