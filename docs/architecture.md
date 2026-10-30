# Architecture

Couch TV is a Tizen web app in `web/`. Each JavaScript file is a plain `<script>` that attaches
**one global**. `index.html` loads them in dependency order, and `main.js` wires them together.

```
             ┌──────────── TMDB API (catalog, artwork, seasons, recommendations)
             │
 pstream.js ─┼──────────── Stream provider on the LAN (stream sources, HLS relay)
 (PStream)   │
             ▼
  data.js (Data) ── localStorage (library, caches)
      │
      ├── Shell + Kit ── screens: home, browse, search, details, settings
      │
      └── main.js ── Player (AVPlay on the TV, <video> on a desktop)
```

## Files

| File | Global | Role |
|---|---|---|
| `web/index.html` | | Loads CSS and scripts in order; shows a splash loader until Home paints |
| `web/config.xml` | | Tizen manifest: app ID `CouchTV001.CouchTV`, privileges (internet, tv.inputdevice) |
| `js/kit.js` | `Kit` | UI building blocks: `el`, `icon`, `card`, `loader`, `Row`, `Grid`, `Tabs` |
| `js/shell.js` | `Shell` | Screen registry and stack, tab bar, focus glass, toast, confirm dialog, loading overlay, offline banner, exit dialog |
| `js/screens/home.js` | | Focused title cover, Continue Watching, My List, Because You Watched, catalog rows |
| `js/screens/browse.js` | | Movies, Series and My List: filter tabs, sort tabs, 5-column grid |
| `js/screens/search.js` | | On-screen keyboard, recent searches, popular titles, results grid |
| `js/screens/details.js` | | Title page: actions, seasons, episodes, More Like This |
| `js/screens/settings.js` | | Settings list with a help side panel |
| `js/screens/live.js` | | Sports: event views, sport filter, channel grid and timed refresh |
| `js/player.js` | `Player` | Full-screen player: controls, seeking, subtitles, Up Next, quality, episodes |
| `js/secrets.js` | `COUCH_SECRETS` | TMDB key. **Git-ignored**; never commit it |
| `js/live.js` | `Live` | Relay sports catalog, local schedule status, commentary selection and M3U channels |
| `js/pstream.js` | `PStream` | TMDB requests and the stream provider adapter |
| `js/data.js` | `Data` | The DataSource: catalog rows, browse, search, details, library and settings |
| `js/main.js` | | Integrator: `Data.play`, the single key listener, error logging, media keys, settings applied globally |
| `css/*.css` | | `base` (tokens, shell), `loader`, `screens` (kit, home, browse, settings), `search`, `details`, `player` |
| `fonts/inter-latin.woff2` | | Inter, bundled so nothing loads from the network |
| `dev.html`, `js/dev/*` | | Desktop harness with a mock `Data` (not shipped to the TV) |
| `player-dev.html` | | Desktop harness for the player alone (not shipped) |

## Screens and the Shell

Each screen file registers a factory at load time:

```js
Shell.register('home', function (ctx) {   // ctx = { data, shell, kit }
  return { el, show(params, returning), hide(), focus(), hideFocus(), handleKey(code), refresh() };
});
```

- **Top-level screens** (in the tab bar): `search`, `home`, `movies`, `series`, `mylist`,
  `settings`. Going to one clears the stack. `movies`, `series` and `mylist` are all the `browse`
  screen with different params.
- **Pushed screens**: `details` with `{ id, item, autoplay }`. `item` is an `ItemSummary`, so the
  page paints instantly before the full record loads. `autoplay: true` starts playback once it
  has loaded (the Play key on cards uses this).
- `show(params, returning)`: `returning` is true when the screen comes back after a pop. Screens
  restore their focus instead of reloading.
- `handleKey` returns `false` to let the Shell act: **Up** at the top edge focuses the tab bar,
  and **Back** pops the stack (or, on a root screen, focuses the tab bar).
- Screens call `shell.tuck(scrolled)` so the tab bar slides away while they are scrolled down.
- `refresh()` runs after `Data.onChange` fires (progress, My List or settings changed).
- Each screen builds its DOM once. Key presses only toggle classes and transforms.

## Keys

`main.js` owns the **only** `keydown` listener in the app:

1. Desktop keys are mapped: Backspace/Escape → Back (10009), Space → Play/Pause (10252).
2. Arrow keys are limited to one per animation frame, so a held key can't run ahead of a slow TV.
3. While the player is open, keys go to `Player.handleKey`; otherwise to `Shell.handleKey`, which
   passes them to the dialog, the tab bar or the current screen.
4. A handler that throws is logged to App health instead of leaving the remote dead.

Key codes: Left 37, Up 38, Right 39, Down 40, OK 13, Back 10009, Play/Pause 10252, Play 415,
Pause 19, Stop 413, Rewind 412, Fast-forward 417, digits 48–57. The TV only sends media keys
that are registered through `tizen.tvinputdevice.registerKey`. `main.js` registers Play/Pause and
Play at start-up; the player registers the rest when it first opens.

## Data flow

### Catalog

- `PStream.list(path, params, page)` calls TMDB and maps each result to an `ItemSummary`. IDs
  look like `tmdb:movie:27205` or `tmdb:tv:1396`.
- `Data.loadRow` and `Data.browse` use TMDB `discover` with filters that drop
  talk shows, news and unreleased titles. Home rows are defined in `ROWS` in `data.js`.
- `PStream.detail(id)` loads a title. For a series it pulls up to 19 seasons plus external IDs in one request
  (`append_to_response`) and fetches the rest in batches of 19. Episodes that haven't aired yet
  are dropped, because they have no stream.
- **Artwork**: `withArt(result, budgetMs)` looks up a title logo and a textless backdrop per
  title (six requests at a time). It waits at most `budgetMs` and then shows what it has; late
  lookups are cached for next time.

### Library

All personal state lives in one `localStorage` object (`couch.library.v2`), saved after every
change. `Data.onChange` listeners then run.

| Part | Shape | Notes |
|---|---|---|
| `progress` | `{ videoUrl: { positionSec, durationSec, at, itemId } }` | Written by the player via `Data.setProgress` |
| `items` | `{ itemId: ItemDetail + at }` | Full title records, so Continue Watching needs no network; capped at 60 |
| `myList` | `[ItemSummary]` | Newest first |
| `recent` | `[string]` | Up to 8 searches |
| `settings` | `{ autoplayNext, subtitles, subtitleSize, quality, noMotion }` | |

Rules worth knowing:

- **Resume** (`resumeFrom`): under 30 s or over 95 % watched starts from the beginning;
  otherwise playback resumes 5 s before where you stopped.
- **Continue Watching**: one entry per title, from its most recent progress. A finished episode
  becomes the next episode at 0:00, and a finished film drops out.
- **Details Play for a series** resumes the Continue Watching episode, falling back to the first
  unfinished episode.
- **Because You Watched** is `Data.related()` of the most recently watched title, requested once
  per seed title.

### Other storage keys

| Key | Contents | Lifetime |
|---|---|---|
| `couch.rows.v3` | First page of each Home row | 6 hours |
| `couch.art.v2` | Logo and backdrop paths per title | 30 days |
| `couch.errors` | Last 20 uncaught errors (Settings → App health) | Until cleared |

Old keys from earlier versions are removed at start-up to free the roughly 5 MB quota.

### Playback

`Data.play(item, video, options)` is set by `main.js`:

1. `PStream.scrape(item, video, quality, tried)` looks up add-on and stream server sources in parallel.
   IMDb IDs select movie or series/episode streams; without one, only the stream server is used. The top five
   playable ranked add-on streams and provider sources form one list, ordered by `sourceOrder`
   (add-ons first by default). Tried URLs are excluded across both families. Add-on URLs come from
   `COUCH_SECRETS.addons` and the stream server from `COUCH_SECRETS.provider`; neither is set by default.
   Torrent URLs and provisional stats endpoints use the server base in `pstream.js`. Streams needing
   audio transcoding still use plain URLs until the server's HLS endpoint is verified.
   See [Stream provider](streaming-provider.md).
2. `Player.open({...})` shows the player immediately with a loader while the stream resolves.
   **Back** cancels. While resolving or buffering, an optional status callback updates the loader
   each second with torrent peers/download percentage when available. A torrent with no playback
   position change for 45 seconds fails over; user pauses and background time do not count.
3. The player reports progress (`onProgress` → `Data.setProgress`) every 5 s and on close.
4. `onFailure` retries with the next untried source from the same position. `onQuality` saves
   the choice and reopens at the same position. `onNext` and `onEpisode` start another episode.

The player uses Samsung **AVPlay** when `webapis.avplay` exists (on the TV), and an HTML5
`<video>` element otherwise. Subtitles (SRT/WebVTT) are parsed by `Data.loadSubtitles` and drawn
by the player.

## Performance rules the code follows

The TV's CPU is slow, and these patterns came from measuring on it:

- Rows and grids build their cards once. Focus changes touch only the two cards involved.
- Layout is read only when scrolling is actually needed, and the measurements are cached.
- Only rows near the focus load images. The rest warm up one at a time once start-up is idle.
- Only `transform` and `opacity` animate. Large backdrops are swapped after `img.decode()`.
- Home rows are cached across launches so Home paints instantly on a cold start.
