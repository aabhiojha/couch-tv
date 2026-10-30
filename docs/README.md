# Couch TV documentation

Couch TV is a streaming app for Samsung smart TVs (Tizen). You browse a TMDB catalog of films and
series with the TV remote and play them through a stream server on your home network. It remembers
where you stopped, keeps a personal My List, and shows subtitles, episode lists and recommendations.

It's a plain HTML/CSS/JavaScript Tizen web app: no framework, no bundler, no npm dependencies at
runtime. The code is written for the TV's old browser engine (Chromium 76) and a slow TV CPU.

## Guides

| Guide | For |
|---|---|
| [User guide](user-guide.md) | Using the app with the remote: every screen, key and setting |
| [Architecture](architecture.md) | How the code is organised: modules, data flow, keys, storage |
| [Development](development.md) | Setting up, the desktop harness, tests, coding rules |
| [Deploying to the TV](deployment.md) | Packaging, installing, launching and debugging on the TV |
| [Stream provider](streaming-provider.md) | Setting up sources, and the stream server and sports relay APIs |
| [Torrent server](torrent-server.md) | The Stremio streaming server that plays torrents: service, cache, verified API, CORS |

[`CONTRACT.md`](../CONTRACT.md) at the repo root is the original module contract. Its Kit, Shell
and DataSource interfaces still hold. The sections on the Internet Archive catalog and the C++
core are history (see "Current state" at its top).

## Quick start

```sh
# 1. TMDB key (once): web/js/secrets.js is git-ignored
echo 'window.COUCH_SECRETS = { tmdbKey: "<your TMDB v3 API key>" };' > web/js/secrets.js

# 2. Tests and the Chromium 76 compatibility check
./build.sh

# 3. Try the UI on the desktop with mock data
cd web && python3 -m http.server 8000     # open http://localhost:8000/dev.html at 1920×1080

# 4. Install and launch on the TV (needs Tizen Studio, the "couch" signing profile, Developer Mode)
./build.sh install
```

## At a glance

| | |
|---|---|
| Target | Samsung TV, Tizen 6.0, Chromium 76, 1920×1080, remote control only |
| App ID | `CouchTV001.CouchTV` (`web/config.xml`), version 0.4.0 |
| Catalog | TMDB API v3 (titles, artwork, seasons, recommendations) |
| Streams | Your stream server, `COUCH_SECRETS.provider` (`web/js/pstream.js`, [sources](streaming-provider.md)) |
| Torrents | Your Stremio add-ons, `COUCH_SECRETS.addons` (`web/js/addons.js`), played through the torrent engine on the TV ([details](torrent-server.md)) |
| Sports | A schedule catalog (`sports.json`) from your sports relay, plus configured M3U channels; English/Hindi/Nepali preferred |
| Storage | `localStorage` on the TV: watch progress, My List, settings, caches |
| Tests | `node tests/test_data.js`, `node tests/test_pstream.js`, `node tests/test_addons.js`, `node tests/test_live.js`, `node tools/check-js.js` |
