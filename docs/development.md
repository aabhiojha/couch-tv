# Development

## Requirements

| Tool | Used for |
|---|---|
| Node.js 22+ | Tests, `tools/check-js.js`, `tools/shot.js` (uses the built-in `WebSocket`) |
| Emscripten SDK at `~/emsdk` | Only for the copy of `acorn` that `check-js.js` loads from it |
| Google Chrome | `tools/shot.js` runs it headless for screenshots |
| Python 3 (or any static server) | Serving `web/` for the desktop harness |
| Tizen Studio | Packaging and installing on the TV (see [Deploying to the TV](deployment.md)) |

There is no `npm install`, and the app has no runtime dependencies.

## Secrets

`web/js/secrets.js` is git-ignored and holds the TMDB v3 API key and your [sources](#sources). Start from
the example:

```sh
cp web/js/secrets.example.js web/js/secrets.js
```

Without it, every catalog request fails with "TMDB key is missing from js/secrets.js". Don't
commit it, paste it into issues, or log it.

## Frame drops on the TV

`tools/frames.js` measures smoothness on the TV itself: it attaches to Couch TV running under the inspector
(`sdb shell 0 debug CouchTV001.CouchTV`, then `sdb forward tcp:9342 tcp:<inspector port>`), presses remote keys
through four scenarios (along a Home row, between Home rows, along the tab bar, down the Movies grid) and prints
dropped frames, the worst frame and long tasks. `off:shimmer,parallax,pill,fade,clicks` switches effects off to
compare; `PROFILE=1` adds the functions that used the most CPU. The TV ends debug sessions after a minute or two,
and runs vary by about 20 dropped frames, so compare several runs. Measured 2026-10-27, ten key presses each:

| | Home row | Home rows | Tab bar | Movies grid |
|---|---|---|---|---|
| Polish as first shipped (shimmer on every unloaded card) | 306 | 283 | 275 | 203 |
| After the fixes | 65 | 174 | 57 | 144 |
| Every polish effect off | 75 | 144 | 38 | 143 |
| Row artwork requested after a move settles | 89–104 | 145 | 67 | 143–166 |

What's left is mostly card artwork arriving (`off:images` brings Home rows to ~130 and the Movies grid to ~94).
Tried without gain: hiding rows scrolled past, and dropping the rows' `will-change` layers.

Follow-up on 2026-10-27, median of three sequential `tools/frames.js` runs per build
(dropped frames; lower is better):

| Build | Home row | Home rows | Tab bar | Movies grid |
|---|---:|---:|---:|---:|
| Before this pass | 105 | 148 | 63 | 157 |
| Cover waits 1 s instead of 450 ms | 117 | 154 | 57 | 149 |
| Also demote distant row tracks and unused focus layers (row demotion reverted) | 143 | 164 | 78 | 159 |
| Final: cover delay, unused focus layers hidden, smaller artwork look-ahead | 103 | 153 | 56 | 161 |

The final differences are within the observed ±25% run-to-run noise: no demonstrated smoothness gain.
Demoting row tracks raised the Home-row median, so their original transforms and layer hints remain.
Unused glass highlights are now hidden, and inactive tab pills release their `will-change` hints.
Home preloads only its next row after 500 ms; each row requests four pictures then one more, and a
four-column grid requests eight then four more (previously eight more). Hidden Home/browse screens
stop pending artwork look-ahead. The cover follows after one second of rest. These reduce speculative
work but can leave placeholders visible longer during fast navigation. The benchmark ends 800 ms
after the last key, so it does not include the final cover update at the new one-second delay.


### Background apps and key handling (2026-10-27)

Netflix (`org.tizen.netflix-app`) was confirmed running through `tizen.application.getAppsContext`.
It was closed with `sdb shell 0 kill org.tizen.netflix-app` and remained absent during the subsequent
measurements. No app data or startup settings were changed. Median dropped frames from three runs:

| Build / background state | Home row | Home rows | Tab bar | Movies grid |
|---|---:|---:|---:|---:|
| Current build, Netflix running | 133 | 153 | 63 | 191 |
| Same build, Netflix closed | 91 | 140 | 53 | 173 |
| Netflix closed, active-screen logo lookup | 108 | 142 | 78 | 169 |

The initial Home-row runs ranged from 76 to 175 drops. The TV had just been turned on, and caches
warmed during the sequential tests, so this is not proof that Netflix caused the difference. The
key-handler change also shows no consistent frame-rate improvement across scenarios.

The CPU profile did identify avoidable work in `shell.js`'s `parallax`: scanning cached screens and
reading card widths after focus writes. It now finds the focused logo in the current screen without
reading layout. In the ten-key Home-rows trace, synchronous keydown handling fell from a median
17.6 ms (max 41.0 ms) to 4.1 ms (max 10.8 ms) on a warm run. Its sampled self time fell from 163 ms
to 5 ms across that scenario. The first trace after reinstall still had a 149 ms cold key outlier;
this change does not remove startup stalls. Rasterization, image decoding, layer updates and GPU
waits still dominated the visible gaps. `tests/test_parallax.js` checks active-screen selection,
logo movement/reset and the no-logo/no-screen cases. TV navigation and glass alignment checks passed.

## Sources

Couch TV ships no stream sources; `web/js/secrets.js` sets them (copy `web/js/secrets.example.js`).
[Sources](streaming-provider.md) describes each setting and the stream server and sports relay APIs.

- `addons: ['<add-on URL>', …]`: Stremio add-ons asked for streams (a base URL or a `…/manifest.json`
  URL). For a legal end-to-end test, run `node tools/test-addon.js 7000`, set
  `addons: ['http://<this computer>:7000']`, then play Sintel.
- `provider: 'http://<host>:<port>'`: a stream server for films and episodes.
- `playlists: ['<M3U URL>', …]`: Live TV playlists (any M3U, including an IPTV provider's
  `get.php?username=…&password=…&type=m3u_plus` link; its films and series are skipped). Without it,
  iptv-org's sports playlist is used. Keep provider links here, since they carry your login.
- `sportsRelay: 'http://<host>:<port>'`: the Sports screen's schedule. A `…/live.m3u` playlist's server
  is used too. Channels from the other playlists are merged into **Channels** by name.

## Running on the desktop

Serve `web/` and open a page at a **1920×1080** window size (the UI has a fixed layout):

```sh
cd web && python3 -m http.server 8000
```

| Page | What it is |
|---|---|
| `http://localhost:8000/dev.html` | Every screen with a **mock `Data`** (`js/dev/mock-data.js`): about 40 public-domain titles per row, series with seasons and subtitles, 300 ms latency, and one request that fails once so you can test retry |
| `http://localhost:8000/player-dev.html` | The player alone: a film with subtitles, a fake next episode, starting near the end so Up Next shows |
| `http://localhost:8000/index.html` | The real app against TMDB and the stream provider (needs `secrets.js`; the provider only answers this laptop and the TV) |

Keys on a desktop: arrows, Enter = OK, Backspace/Escape = Back, Space = Play/Pause, letters and
digits type in Search.

When you add a function to `Data`, add it to `js/dev/mock-data.js` too, or guard the call in the
screen (as Home does with `data.becauseYouWatched`).

## Checks

`./build.sh` runs all of them and stops at the first failure:

```sh
node tests/test_data.js      # library, resume, Continue Watching, subtitles, catalog mapping, artwork cache
node tests/test_pstream.js   # TMDB mapping, seasons, retries, source and quality selection
node tests/test_artwork.js   # deferred artwork, cancellation and bounded prefetch
node tests/test_parallax.js  # logo movement stays in the active screen without reading layout
node tools/check-js.js       # every web/ file parses as ES2019 and avoids CSS Chromium 76 lacks
```

Each test is a plain Node script with `assert`: no framework, no fixtures directory to set up
(subtitle samples live in `tests/fixtures/`). `test_data.js` runs `data.js` in a `vm` sandbox with
a fake `localStorage`, clock and `PStream`. `test_pstream.js` replaces `fetch`.

## Screenshots and scripted key presses

`tools/shot.js` drives a page in headless Chrome, presses remote keys and saves screenshots:

```sh
node tools/shot.js http://localhost:8000/dev.html /tmp/home wait:1500 Down Down shot Enter wait:800
#   steps: Left Right Up Down Enter Back Space | key:<keyCode> | wait:<ms> | shot | eval:<js>
#   a final screenshot is always taken; JS errors on the page are printed
```

`key:10252` presses Play/Pause, and `eval:` prints the value of an expression, for example
`eval:document.querySelector('.details-play').textContent`. To attach to the app running on the
TV instead, see [Debugging on the TV](deployment.md#debugging-on-the-tv).

## Rules for code in `web/`

**Chromium 76 compatibility.** The TV's engine is Chromium 76, so JavaScript must be ES2019.

- Not allowed in JS: `?.`, `??`, `||=`/`&&=`/`??=`, class fields and `#private`, `import`/`export`,
  top-level `await`, `Array.prototype.at`, `replaceAll`, `Object.hasOwn`, `structuredClone`,
  `Promise.any`/`allSettled`, numeric separators.
- Not allowed in CSS: flexbox `gap` (use margins, or `grid-gap` in grids), `aspect-ratio`,
  `inset`, `:is()`, `:where()`, `:focus-visible`, `backdrop-filter`.

`check-js.js` catches most of these, but not all.

**Structure.**

- One global per file, loaded with a plain `<script>`. No bundler, frameworks or web fonts beyond
  the bundled Inter.
- Only `main.js` listens for `keydown`. Screens and components get keys through `handleKey`.
- Data strings go in with `textContent`, never `innerHTML`.
- Comments explain *why* when it isn't obvious. Don't leave `console.log` behind.

**Performance on the TV.**

- Build DOM once per screen; on key presses change classes and transforms only.
- Animate only `transform` and `opacity`; use about 240 ms for focus and 260–300 ms for scrolling. Animations must also look
  right with Settings → Remove animations (the `no-motion` class on `<html>`).
- Never read layout right after writing classes inside a loop. Cache measurements.

**10-foot UI.**

- Minimum text size 24px, body 28–32px, titles 44–72px.
- Exactly one obvious focus at a time: the sliding glass on artwork, a white fill on tabs, buttons and rows.
- Content stays inside the TV safe area: 90px at the sides, below the tab bar on root screens.
- Brand tokens are in `css/base.css` and documented in `DESIGN.md` (Apple TV / tvOS dark palette, Inter).

## Common tasks

**Add a Home row.** Add an entry to `ROWS` in `data.js`, either `{ key, title, path }` for a
TMDB list path or `{ key, title, kind: 'movie'|'tv', params }` for a `discover` query. Home picks
it up from `Data.rows`. The row cache key `couch.rows.v3` refreshes within 6 hours; bump the
version to force a refresh.

**Add a setting.** Add a default to `loadLibrary()` in `data.js`, then an item in the `sections`
list in `screens/settings.js` (`toggle`, `choice` with `options`, or `action`). If it affects the
whole app, apply it in `main.js` on start-up and on `Data.onChange`, as `noMotion` does.

**Add a screen.** Create `js/screens/<name>.js` that calls `Shell.register`, add its
`<script>` to `index.html` (and to `dev.html`), and add CSS. Going to a name that isn't
registered shows a "Coming soon" toast instead of crashing.

**Change the stream provider address.** Edit `PROVIDER` at the top of `js/pstream.js`, and keep
the URL checks in `scrape()` pointing at the same origin.
