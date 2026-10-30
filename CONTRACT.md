# Couch TV — module contract (v2)

Couch TV is a Samsung TV app for browsing and playing public-domain / Creative Commons films and
TV series from the Internet Archive. Target device: Samsung 2021 TV, **Tizen 6.0, Chromium M76**,
fixed **1920×1080** viewport, controlled only with a TV remote (arrows, Enter, Back, media keys).

The app is a Tizen web app (`web/`).

> **Current state (v0.4):** the Internet Archive catalog and the C++/WebAssembly core (Module A below)
> were removed. The catalog is TMDB via `web/js/pstream.js`; time formatting, resume rules and subtitle
> parsing live in `web/js/data.js`. Sections about Module A, `core.js` and archive collections are history.
v1 (home rows, details, player) works on the TV. v2 makes it a full streaming app. Work is split into
modules built in parallel. **Only edit the files your module owns.** The v1 code is in the repo:
reuse its look, its good parts and its lessons, but you may rewrite your files freely.

---

## Rules for every module

**Chromium 76 compatibility (hard requirement).** JS must parse as ES2019. Not allowed:
`?.`, `??`, class fields / `#private`, `import`/`export` modules, top-level await,
`Array.prototype.at`, `flat`/`flatMap` are fine (Chrome 69), `String.prototype.replaceAll`,
`Object.hasOwn`, `structuredClone`, `Promise.any`, `Promise.allSettled`, `||=`/`&&=`/`??=`,
numeric separators. CSS not allowed: flexbox `gap` (use margins), `aspect-ratio`, `inset`, `:is()`,
`:where()`, `:focus-visible`, `backdrop-filter` (unsupported/slow on the TV). Use `grid-gap` for grids.
Check with: `node tools/check-js.js` (must print `ok`).

**Performance on a TV CPU.** Build DOM once per screen/component and update classes and transforms
on key presses; never rebuild a list per key press. Animate only `transform` and `opacity`.
Large blurred images: blur a small `<img>`/background once with `filter: blur()` on a static layer,
never animate it. Lazy-load images (`loading` attribute isn't supported in 76 — set `src` when the
card is within ~2 screens of the viewport, or just let rows of ≤ 30 load normally).

**Code style.** Plain `<script>` files, each attaching exactly one global. No bundler, no npm, no
frameworks, no web fonts. `textContent` for all data strings — never `innerHTML` with data. Comments
only where the *why* isn't obvious. No `console.log` left behind.

**Keys.** `web/js/main.js` (integrator) owns the single document `keydown` listener:
`Player.handleKey(code)` while `Player.isOpen()`, else `Shell.handleKey(code)`. **No other module adds
a `keydown` listener** (dev harnesses excepted). Codes (`e.keyCode`): Left 37, Up 38, Right 39,
Down 40, Enter 13, Back 10009, MediaPlayPause 10252, MediaPlay 415, MediaPause 19, MediaStop 413,
MediaRewind 412, MediaFastForward 417, digits 48–57. Desktop aliases (mapped before routing):
Backspace 8 / Escape 27 → Back, Space 32 → MediaPlayPause. Letters typed on a desktop keyboard
(65–90) are passed through unchanged (the search keyboard may accept them as a convenience).

**Brand.** The Apple TV app on tvOS (DESIGN.md has the full system). Colors (base.css `:root`): background
`#000`, sheets `#1c1c1e`/`#2c2c2e`, translucent white fills for controls, text `#fff`, secondary text
`rgba(235,235,245,.62)`; sentence case, no uppercase labels. Wordmark: lowercase "couch tv", "tv" at 50%
white, in the tab bar. Font: Inter (bundled `fonts/inter-latin.woff2`, OFL, 400–800), body 29px, titles
600–700. Minimum text 24px. TV safe area: 90px at the sides; the tab bar sits across the top and root
screens start below it (y ≈ 150). Focus is always obvious: artwork gets the sliding glass (shell.js) and
1.08 scale; tabs, buttons and rows fill white with black text and lift.
Motion: about 240ms for focus and 260–300ms for scrolling, using transform and opacity. 10-foot UI:
legible from a sofa 3 m away, one obvious focus at all times.

---

## Data shapes (shared)

```
ItemSummary = { id, title, year, description, thumb, rating }    // year "" if unknown;
                                                                 // rating 0–5 (0 = none)
ItemDetail  = ItemSummary + { videos: [Video], isSeries, runtime, creator, subjects, language }
              // runtime: "1h 32m" / "45m" / "" ; creator: string ("" if unknown);
              // subjects: up to 6 short genre strings ; language: "English" / "" ;
              // isSeries = videos.length > 1
Video       = { name, title, url, durationSec, season, episode, subtitles: [Subtitle], description }
              // description: episode synopsis ("" if none); unaired episodes are not listed
Subtitle    = { label, url }     // label e.g. "English (auto)"; url absolute
Cue         = { start, end, text }  // seconds; text may contain "\n"
```

---

## DataSource — `window.Data` (integrator implements; UI modules mock it in dev harnesses)

```
Data.rows                      // [{key, title}] catalog rows for Home, e.g. {key:'feature_films', title:'Classic Films'}
Data.sections                  // [{key:'movies', title:'Movies', filters:[{key, title}]},
                               //  {key:'series', title:'Series', filters:[{key, title}]}]
                               // filters are collections; the first filter is "All"
Data.sorts                     // [{key:'popular',title:'Popular'},{key:'newest',...},{key:'oldest',...},{key:'title',title:'A–Z'}]
Data.loadRow(key, page)        -> Promise<{items:[ItemSummary], total}>      // page starts at 1
Data.browse(sectionKey, filterKey, sortKey, page) -> Promise<{items, total}>
Data.search(query, page)       -> Promise<{items, total}>   // query "" resolves {items:[], total:0}
Data.loadItem(id)              -> Promise<ItemDetail>
Data.related(item)             -> Promise<[ItemSummary]>    // "More like this", ≤ 20, never contains item itself
Data.becauseYouWatched()      -> Promise<{title, items} | null>  // related() of the latest watched title; Home row
Data.loadSubtitles(url)        -> Promise<[Cue]>
Data.formatTime(sec)           -> "1:02:05" / "4:05"
Data.getProgress(videoUrl)     -> {positionSec, durationSec} | null
Data.resumeFrom(videoUrl)      -> seconds to resume at (0 = start)   // < 30 s or > 95 % watched → 0
Data.nextVideo(item, video)    -> Video | null              // next episode in order
Data.continueWatching()        -> [{item: ItemSummary, video: Video, positionSec, durationSec}]  // newest first
Data.removeFromContinue(itemId)
Data.inMyList(id) -> boolean;  Data.toggleMyList(itemSummary) -> boolean (new state);  Data.myList() -> [ItemSummary]
Data.settings() -> {autoplayNext: bool, subtitles: bool, subtitleSize: 'small'|'medium'|'large'}
Data.setSetting(key, value)
Data.clearHistory();  Data.clearMyList()
Data.recentSearches() -> [string] (≤ 8, newest first);  Data.addRecentSearch(query);  Data.clearRecentSearches()
Data.play(item, video, {startOver: bool})   // opens the player; integrator implements
Data.onChange(fn)                           // fn() after progress / My List / settings change
```

---

## Shell & UI kit — `window.Shell`, `window.Kit` (Module B)

### Shell
```
Shell.init(rootEl, data)
Shell.register(name, factory)     // factory(ctx) -> Screen; ctx = {data, shell: Shell, kit: Kit}
Shell.go(name, params)            // push a screen (e.g. Shell.go('details', {id, item}));
                                  // details also takes autoplay: true → plays what Play would once loaded
Shell.back()                      // pop; on a top-level screen other than home → home; on home → exit dialog
Shell.handleKey(code) -> boolean
Shell.toast(text)                 // 3 s message at the bottom
Shell.confirm({title, body, confirm, cancel}) -> Promise<boolean>
```
Screen object returned by a factory:
```
{ el,                     // root element, created once by the factory
  show(params, returning) // returning = true when shown again after a pop (restore focus, don't reload)
  hide(),
  focus(),                // put focus back inside the screen (after the tab bar releases it)
  handleKey(code) -> bool,// return false for Up at the screen's top edge → Shell focuses the tab bar;
                          // return false for Back → Shell.back()
  refresh() }             // optional: Data.onChange fired (progress, My List, settings)
```
Top-level screens (in the tab bar, left to right): `search`, `home`, `movies`, `series`, `mylist`,
`settings`. Pushed screens: `details` (params `{id, item}` where item is an ItemSummary for instant
render), `browse` is the screen used for movies/series/mylist with params `{section}` or
`{mylist:true}`.

**Tab bar:** across the top, capsule tabs centred (Search and Settings as icons), wordmark at the left.
Left/Right moves, Enter or Down opens that screen (or returns focus to the current one). Back from a
root screen focuses the bar; Back on the bar → home (or exit dialog on home). Screens call
`Shell.tuck(true)` while scrolled down so the bar slides away; pushed screens (details) hide it.

**Exit dialog:** "Exit Couch TV?" Stay / Exit (Stay focused); Exit calls
`tizen.application.getCurrentApplication().exit()` when `window.tizen` exists.

**Offline banner:** when `navigator.onLine` is false (listen to `online`/`offline`), a slim banner
at the top: "You're offline — check your connection".

### Kit components (used by screens in other modules — implement exactly)
```
Kit.el(tag, className, text) -> HTMLElement
Kit.icon(name) -> SVGElement       // names: search, home, film, tv, list, settings, play, plus, check,
                                   // restart, star, back, clock — 24px viewBox, currentColor
Kit.card(item, {progress, wide}) -> HTMLElement
      // poster card: 16:9 thumb (title-on-coral fallback when no/failed image), title (1 line,
      // ellipsis; 2 lines when focused), year · ★ rating (rating shown only if > 0);
      // progress 0–1 → thin coral bar at the bottom of the thumb; wide → 480px card for Continue Watching
Kit.Row({title, onSelect(item, index), onPlay(item, index), onNeedMore(), cardOptions(item) -> {progress}})
      // remote Play (10252/415) on a card: onPlay, else Shell.go('details', {id, item, autoplay: true}) (Grid too)
      -> { el, setItems(items), appendItems(items), setLoading(bool), setError(onRetry),
           focus(index?), blur(), handleKey(code) -> bool, index }
      // horizontal; Left/Right/Enter handled; returns false for Left at index 0, Up, Down, Back;
      // onNeedMore when focus is within 5 of the end; smooth transform scrolling
Kit.Grid({columns, onSelect(item, index), onNeedMore(), cardOptions})
      -> { el, setItems(items), appendItems(items), setLoading(bool), setError(onRetry), setEmpty(text),
           focus(index?), blur(), handleKey(code) -> bool, index }
      // returns false for Up from the first row, Left from the first column, Back;
      // scrolls vertically (transform) to keep the focused row in view; onNeedMore near the end
Kit.Tabs({items: [{key, title}], onChange(key)}) -> { el, focus(), blur(), handleKey(code) -> bool, value }
      // pill tabs (used for browse filters/sorts, details seasons); Left/Right moves and calls onChange
```

---

## Module A — C++ core (`src/catalog.h`, `src/catalog.cpp`, `src/bindings.cpp`, `tests/test_catalog.cpp`)

Keep all v1 functions working (`searchUrl`, `parseSearch`, `parseItem`, `formatTime`, `resumeFrom`)
and extend:

- **`queryUrl(query, collections, sort, page, rows) -> string`** — advancedsearch URL.
  `collections` is a comma-separated list (empty = no collection filter). `sort`: `popular`
  (downloads desc), `newest` (year desc), `oldest` (year asc), `title` (titleSorter asc).
  Always add `mediatype:(movies) AND licenseurl:(*publicdomain* OR *creativecommons*)`.
  `query` is user text: lowercase, keep only letters/digits (UTF-8 letters allowed), split on
  everything else, drop empties, max 8 words. If no words → the URL has no text clause. Otherwise
  each word becomes `(title:W* OR subject:W* OR creator:W*)` for the **last** word (prefix search
  while typing) and `(title:W OR subject:W OR creator:W)` for the others, joined with AND.
  Fields: identifier, title, year, description, avg_rating. `searchUrl(c, page, rows)` becomes
  `queryUrl("", c, "popular", page, rows)`.
- **`parseSearch`** also returns `rating` from `avg_rating` (number, rounded to 1 decimal; 0 if missing).
- **`parseItem`** also returns: `rating` (metadata `avg_rating` if present, else 0), `runtime`
  (from the first video's duration for films, or "" for series: "1h 32m", "45m", "" if 0),
  `creator` (string or array joined ", "), `subjects` (metadata `subject`: string split on `;` and
  `,`, or array; trimmed, case-insensitively de-duplicated, title-cased, max 6, each ≤ 24 chars),
  `language` (map `eng`/`en`/`english` → "English", `fre`/`fr` → "French", `ger`/`de` → "German",
  `spa`/`es` → "Spanish", `ita`/`it` → "Italian", `jpn`/`ja` → "Japanese", else the raw value
  title-cased, "" if missing), and per video `subtitles`: files named `<base>.srt`, `<base>.vtt`,
  `<base>.<anything>.srt|vtt` whose base matches the video's base name (case-insensitive).
  Label: language word from the middle part when recognisable (`en`, `eng`, `english`, …), else
  "English"; append " (auto)" when the name contains `asr` or `autogenerated`. One subtitle per
  label; prefer `.vtt` over `.srt` for the same label. url built like video urls.
- **`parseSubtitles(text) -> string`** → JSON `[Cue…]`. Accepts SRT and WebVTT: optional BOM,
  CRLF or LF, optional cue numbers / identifiers, `WEBVTT` header and `NOTE`/`STYLE` blocks skipped,
  timestamps `HH:MM:SS,mmm`, `HH:MM:SS.mmm`, `MM:SS.mmm`; the fraction is a decimal fraction of a
  second (so `,95` = 0.95 s, `.5` = 0.5 s). Strip tags (`<i>`, `<c.x>`, `{\an8}`), decode entities,
  trim lines, drop empty cues and cues with end ≤ start, sort by start. Malformed blocks are skipped.
- **`formatRuntime(seconds) -> string`** — "1h 32m", "45m", "" for 0/invalid.

Fixtures: `tests/fixtures/*.json` (search results now include `avg_rating`; `metadata_movie.json`
has `his_girl_friday.asr.srt`; `metadata_series2.json` has `Bonanza s01e19.autogenerated.vtt` …),
`subtitles_sample.srt`, `subtitles_sample.vtt` (real files, truncated mid-cue at the end).

**Never rely on C++ exceptions** (disabled in the WASM build): `json::parse(text, nullptr, false)` +
`is_discarded()`, type checks before every access, `dump(-1, ' ', false, json::error_handler_t::replace)`.

Checks (both must pass):
```
mkdir -p build && g++ -std=c++17 -Wall -Wextra -Ithird_party src/catalog.cpp tests/test_catalog.cpp -o build/test_catalog && build/test_catalog
source ~/emsdk/emsdk_env.sh && emcc src/catalog.cpp src/bindings.cpp -Ithird_party -O2 -lembind -o build/core.js -sMODULARIZE -sEXPORT_NAME=createCore -sENVIRONMENT=node -sSINGLE_FILE && node -e "require('./build/core.js')().then(c=>console.log(c.formatRuntime(5520), c.queryUrl('his gir','feature_films,classic_tv','newest',1,20)))"
```

---

## Module B — Shell, UI kit, Home, Browse, Settings

Owns: `web/index.html`, `web/css/base.css`, `web/css/screens.css`, `web/js/kit.js`, `web/js/shell.js`,
`web/js/screens/home.js`, `web/js/screens/browse.js`, `web/js/screens/settings.js`,
`web/dev.html`, `web/js/dev/mock-data.js`, `web/js/dev/dev-main.js`. Delete the v1 files
`web/css/app.css`, `web/js/nav.js`, `web/js/screens.js`, `web/js/mock-data.js`, `web/js/dev-main.js`.

`index.html` loads, in order: `css/base.css`, `css/screens.css`, `css/search.css`, `css/details.css`,
`css/player.css`, `$WEBAPIS/webapis/webapis.js`, `core.js`, `js/kit.js`, `js/shell.js`,
`js/screens/home.js`, `js/screens/browse.js`, `js/screens/settings.js`, `js/screens/search.js`,
`js/screens/details.js`, `js/player.js`, `js/data.js`, `js/main.js`. Body:
`<div id="app"></div><div id="player"></div>`. Each screen file registers itself:
`Shell.register('home', function (ctx) { … })` at load time (Shell must accept registrations before
`init`).

- **Home:** a cover backdrop, title, and details follow the focused card. **Continue Watching** is the first row when non-empty (wide cards with progress;
  Enter resumes playback directly), followed by **My List** (only when non-empty), recommendations,
  then one Row per `Data.rows`. Up/Down moves between rows; the page scrolls with a transform
  to keep the focused row near the top. Refresh Continue
  Watching / My List rows on `refresh()` without losing focus.
- **Browse** (used for `movies`, `series`, `mylist`): page title, a Tabs row of the section's filters,
  a Tabs row of sorts (not for My List), then a 5-column Grid with infinite loading via
  `Data.browse`. My List shows `Data.myList()` with an empty state ("Nothing here yet — add titles
  with the + button on any title"). Up from the grid's first row → sort tabs → filter tabs.
- **Settings:** list of rows, Up/Down to move, Enter to change: Autoplay next episode (On/Off),
  Subtitles (On/Off), Subtitle size (Small/Medium/Large), Clear watch history (confirm), Clear My
  List (confirm), Clear recent searches; then an About block: app version (0.2.0), "Films and series
  from the Internet Archive (archive.org). Only titles marked public domain or Creative Commons
  are shown."
- Loading skeletons, error states with retry, empty states — everywhere data loads.

`dev.html` + `js/dev/*`: desktop harness with a complete mock `Data` (every DataSource function,
realistic shapes, ≥ 40 items per row, some series with seasons and subtitles, 300 ms latency, one
failure-once path to exercise retry). It must also load `js/screens/search.js` and
`js/screens/details.js` *if present* (they come from another module; guard with
`Shell.register` simply not being called when the file is absent). Navigating to an unregistered
screen shows a toast "Coming soon" instead of crashing.

---

## Module C — Search & Details (built after Module B, on its Kit)

Owns: `web/js/screens/search.js`, `web/js/screens/details.js`, `web/css/search.css`, `web/css/details.css`.

- **Search:** left: query display (large, with blinking caret) above an on-screen keyboard grid
  (a–z, 0–9, then wide keys: Space, ⌫ Delete, Clear) navigable with arrows, Enter types. Desktop
  letters/digits (keyCodes 48–57, 65–90) and Backspace-as-Back exception: on this screen, keyCode 8
  arrives as Back (10009) — so Back deletes a character while the query is non-empty, and only
  leaves the screen when the query is empty. Right from the keyboard's right edge moves into results.
  Right side: when the query is empty, "Recent searches" (Enter re-runs, saved via
  `Data.addRecentSearch` when the user opens a result) and a "Popular right now" grid
  (`Data.loadRow('feature_films', 1)`); otherwise a results Grid (4 columns) from `Data.search`,
  debounced 500 ms after the last keystroke, with a result count, loading state, "No results for
  'x'" empty state, infinite loading. Stale responses (older query) are ignored.
- **Details:** renders instantly from `params.item`, then fills in from `Data.loadItem(id)`.
  Backdrop (blurred thumb) + sharp 16:9 hero image on the right for films. Eyebrow FILM / SERIES,
  title, meta line (year · runtime · ★ rating · language), subjects as small chips, "Created by"
  line when creator is known, description (5-line clamp). Buttons: **Play / Resume H:MM:SS**
  (resume uses `Data.getProgress`), **Start Over** (only when there is progress; calls
  `Data.play(item, video, {startOver:true})`), **My List** (+ / ✓ toggles `Data.toggleMyList` with a
  toast). Series: **Episodes** with season Tabs (when > 1 season), episode list (S·E label, title,
  duration, progress bar only when watched, a "CC" badge when subtitles exist), Play on a series
  resumes the first unfinished episode. Below: **More Like This** Row from `Data.related(item)`
  (Enter opens that item's details — push, so Back returns). Up/Down moves between buttons,
  episodes/tabs and the row; the page scrolls with a transform. `refresh()` updates resume labels,
  progress bars and the My List button.

---

## Module D — Player (`web/js/player.js`, `web/css/player.css`, `web/player-dev.html`)

Keep the v1 player (AVPlay + HTML5 backends, overlay, seek accumulation, AbortError handling, all
tested on the TV) and extend `Player.open(opts)`:
```
opts = { url, title, subtitle, startSec, formatTime, onProgress(pos, dur), onClose(),
         subtitles: [Subtitle], subtitlesOn: bool, subtitleSize: 'small'|'medium'|'large',
         loadSubtitles(url) -> Promise<[Cue]>,
         next: {title, subtitle} | null,   // the next episode, if any
         autoplayNext: bool,
         onNext() }                        // called when the next episode should start
```
- **Subtitles:** rendered by the player in a caption box above the progress bar (centered, cream
  text with dark text-shadow + translucent box, size by `subtitleSize`), synced to the current
  time (binary search the sorted cues; update on time callbacks and at least every 250 ms while
  playing). When `subtitlesOn` and tracks exist, load the first track. **Down** opens an options
  sheet at the bottom: "Subtitles: Off / <label>…" (Left/Right to choose, Enter or Down to apply
  and close, Back closes); show "CC" in the overlay when subtitles are available. Failed subtitle
  load → toast-like overlay message "Subtitles unavailable", playback continues.
- **Up next:** when `next` exists and 20 s remain (or on stream end if shorter), show an "Up next"
  card bottom-right: next title, subtitle, a countdown 10 → 0 when `autoplayNext` (Enter = play now,
  Back = dismiss and keep watching); at 0 or on stream end with autoplay → report progress as
  complete, close, call `onNext()`. Without autoplay: the card shows "Play next" (Enter) only.
- On stream end without `next`: report complete and close (as in v1).

`player-dev.html`: opens on load with his_girl_friday.mp4 and its subtitles
(`https://archive.org/download/his_girl_friday/his_girl_friday.asr.srt`) using a tiny local SRT
parser in the harness only, `next` set to a fake episode, `startSec` near the end (e.g. 5470) so
Up next can be exercised.

---

## Integrator (not a Codex module)

Owns `web/js/data.js`, `web/js/main.js`, `web/config.xml`, `web/icon.png`, `build.sh`, `CONTRACT.md`,
`tools/`.

---

## v3 — Artwork from TMDB (Module A extension)

Internet Archive thumbnails are 180×124 px. Cards and Details use TMDB backdrops instead
(16:9, w780 / w1280). C++ owns the cleaning and matching; `data.js` (integrator) does the fetching,
caching and image URLs.

- **`parseSearch`**: request `collection` in `queryUrl`'s field list and add `kind` to each item:
  `"series"` when the item's collection list contains `classic_tv` or `classic_cartoons`, else
  `"film"`. ItemSummary gains `kind`. `parseItem` sets `kind` from `isSeries` ("series"/"film").
- **`artworkQuery(title, year, kind) -> string`** → JSON `{"query", "year", "type"}`.
  `type` = `"tv"` for kind `series`, else `"movie"`. `year` = the given year if it is 4 digits,
  else the first 19xx/20xx in the title, else "". `query` cleaning, in order:
  1. if the title contains a double-quoted part of ≥ 3 chars, use that part (`"You Bet Your Life"
     With Groucho Marx` → `You Bet Your Life`);
  2. cut at the first ` - `, ` : `, ` | `, ` Ep01`/`Ep. 1`, ` S01E02`, ` Episode` (case-insensitive)
     (`Beverly Hillbillies Ep01 The Clampetts…` → `Beverly Hillbillies`);
  3. remove `(…)` and `[…]` parts, 19xx/20xx years, and the words/phrases: public domain, pd,
     episode(s), tv show, tv series, full movie, full series, complete series, collection (+ number),
     ipod, dvd, hd, 1080p, 720p, remastered, colorized (whole words, case-insensitive);
  4. collapse spaces, trim spaces and `-:,.`.
- **`tmdbSearchUrl(query, year, type, apiKey) -> string`** →
  `https://api.themoviedb.org/3/search/<type>?api_key=…&query=…&include_adult=false` plus
  `&year=Y` (movie) / `&first_air_date_year=Y` (tv) when year is non-empty. Percent-encoded.
- **`pickArtwork(raw, query, year, type) -> string`** → JSON `{"backdrop": "/path.jpg"}`, or
  `{"backdrop": ""}` when nothing qualifies (also for invalid JSON). Consider the first 5 results
  that have a `backdrop_path`. Names: `title`/`original_title` (movie) or `name`/`original_name` (tv);
  result year from `release_date` / `first_air_date`. Normalise names: lowercase, `&`→`and`, keep
  a–z0–9 only, drop a leading `the`. A name matches when normalised names are equal, or one contains
  the other and the normalised query is longer than 5 chars. Year rule: if `year` is set, the result
  year must exist and be within ±2; if `year` is empty, require an exact normalised match and a
  result year before 1980 (the catalog is classic; avoids modern remakes). Special case: when `year`
  is set and the response has exactly one result whose year equals `year` exactly, accept it even if
  the name differs (TMDB matched an alternative title, e.g. "Reefer Madness" → "Tell Your Children").
  First qualifying result wins.

Fixtures (real responses): `tests/fixtures/tmdb_movie_his_girl_friday.json` (year 1940),
`tmdb_tv_bonanza.json`, `tmdb_tv_sherlock_holmes.json` (1984, 1954, 1964… — with year 1954 the
1954 series must win), `tmdb_movie_three_stooges.json` (no year: the 2012/2000 films must be
rejected; "Three Stooges" 1965 has no backdrop so the result is ""), and
`tmdb_movie_reefer_madness_1938.json` (single result "Tell Your Children" 1938 → accepted).

---

## v4 — Torrent streaming via Stremio add-ons (v0.5)

Couch TV gains Stremio-style sources: it asks **Stremio add-ons** (no default add-on since the public release) for streams
of a title, and plays torrents through **Stremio's streaming server** running on the laptop
(`http://192.168.1.34:11470`). The existing stream server stays as a second source family.
Four modules are built in parallel on branches off `v0.5-torrents`; **only edit the files you own**.
All v2 rules still apply (Chromium 76 / ES2019, one global per file, no innerHTML with data,
`node tools/check-js.js` and `./build.sh` must pass).

### Shared constants
- Torrent server base: `http://192.168.1.34:11470` (no auth; LAN only).
- Add-on URLs (no default since the public release; a manifest URL ending in `/manifest.json` is also accepted;
  strip that suffix to get the base).
- Torrent stream URL (provisional until Module S confirms): `<server>/<infoHash>/<fileIdx>` — a plain
  HTTP file with Range support. Stats (provisional): `<server>/<infoHash>/<fileIdx>/stats.json`.

### Module S — streaming server (claude). Owns: `~/tv-shinnagans/tv-remote/app/scripts/stremio-server*`,
`~/tv-shinnagans/tv-remote/app/scripts/couch-tv-torrents.service`, `docs/torrent-server.md`
Run the official Stremio streaming server on the laptop as the enabled user service
`couch-tv-torrents.service` on port 11470, reachable from the TV (192.168.1.4), with a disk cache limit
(10 GB) and cache cleanup. Verify with the **legal** Sintel torrent
(`magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10`): playback URL answers `206` to Range
requests at the start and at ~80 %, before the download finishes. Document in `docs/torrent-server.md`
the **exact verified** endpoints: stream URL, stats (peers, downloaded, speed), how fileIdx works when
unknown, HLS transcode URL(s) for files the TV can't decode (e.g. DTS audio), CORS headers on each, and
whether `https://torrentio.strem.fun/stream/movie/tt0133093.json` sends CORS headers (can the TV fetch it
directly?). Never download anything but the Sintel test torrent.

### Module T — test add-on (agy). Owns: `tools/test-addon.js`
A tiny Stremio add-on for end-to-end tests with legal content only: `node tools/test-addon.js [port]`
(default 7000) serves `GET /manifest.json` (id `couch.test`, resources `["stream"]`, types
`["movie"]`, idPrefixes `["tt"]`) and `GET /stream/movie/tt1727587.json` (Sintel, TMDB 45745) →
`{ streams: [{ name: 'Test\n1080p', description: 'Sintel.2010.1080p.x264\n👤 50 💾 1.2 GB ⚙️ test',
infoHash: '08ada5a7a6183aae1e09d831df6748d566095a10', fileIdx: <Sintel.mp4's index> }] }`; any other
id → `{ streams: [] }`. Sends `Access-Control-Allow-Origin: *`. Node stdlib only, < 60 lines.

### Module W — add-on client (codex-work). Owns: `web/js/addons.js`, `tests/test_addons.js`
`window.Addons` (also `module.exports`, like pstream.js):
```
Addons.streams(addonUrls, type, id) -> Promise<[Stream]>   // never rejects
    // type 'movie' + id 'tt0133093' | type 'series' + id 'tt0903747:1:1' (imdb:season:episode)
    // GET <base>/stream/<type>/<id>.json per add-on, in parallel, 8 s timeout each (AbortController);
    // a failing add-on contributes []; results merged, de-duplicated by infoHash+fileIdx (or url)
Addons.parse(rawStream, addonName) -> Stream | null           // null when neither infoHash nor url
Addons.rank(streams, quality) -> [Stream]                      // new sorted array, best first;
    // quality = Data setting: 'best' | 1080 | 720 | 480
Addons.torrentUrl(serverBase, stream) -> string                // '<server>/<infoHash>/<fileIdx>'
Stream = { kind: 'torrent'|'http', infoHash: '' , fileIdx: number|null, url: '',
           addon, title /* first line of the release name */, text /* all raw text */,
           quality: 2160|1080|720|480|0, seeders: number, sizeBytes: number,
           tags: { hevc, tenBit, hdr, dv, dts, truehd, atmos, cam } /* booleans */,
           playable: boolean, needsTranscode: boolean, score: number }
```
Parsing: raw add-on streams look like Torrentio's `{ name: 'Torrentio\n1080p', title or description:
'Release.Name.2020.1080p.BluRay.x264-GRP\n👤 154 💾 2.31 GB ⚙️ YTS', infoHash, fileIdx,
behaviorHints: { filename } }` (older add-ons use `title`, newer `description`) or `{ url, name, title }`.
Read quality from `2160p/4k/uhd`, `1080p`, `720p`, `480p`; seeders from `👤 N`; size from `💾 N GB|MB`.
Tags from release-name words (case-insensitive): hevc = x265/h265/hevc; tenBit = 10bit/10-bit/hi10;
hdr = hdr/hdr10/hdr10+; dv = dv/dovi/dolby vision; dts = dts (incl. dts-hd/dts-x); truehd; atmos;
cam = cam/hdcam/ts/telesync/hdts.
TV rules (Samsung 2021, Tizen 6): `playable = false` when cam, or tenBit without hevc (Hi10P H.264),
or dv without hdr (Dolby Vision-only). `needsTranscode = dts || truehd` (audio the TV can't decode).
Score: prefer the wanted quality (best → 1080 over 2160 because 4K torrents start slowly), then more
seeders (log scale; 0 seeders ranks last), penalise needsTranscode, prefer http over torrent at equal
quality. Unit tests with a fake `fetch` (movie + series ids, timeout, a failing add-on, dedupe,
every tag rule, ranking order). Add `node tests/test_addons.js` to `build.sh`'s test list.

### Module I — integration (codex). Owns: `web/js/pstream.js`, `web/js/data.js`, `web/js/main.js`,
`web/js/player.js`, `web/js/screens/settings.js`, `web/index.html`, `web/js/dev/mock-data.js`,
`tests/test_pstream.js`, `tests/test_data.js`
- `PStream.detail`: add `imdbId` to the item (movie: `imdb_id`; tv: `external_ids.imdb_id`). TMDB allows
  at most **20** `append_to_response` entries — the tv season batches must shrink to 19 to fit `external_ids`.
- `PStream.scrape(item, video, quality, exclude)` returns the same shape as now
  (`{url, headers, qualities, source, remaining}`) but chooses from **one candidate list**: add-on
  streams (via `Addons.streams` + `Addons.rank`, only `playable`, top 5) and stream server sources, ordered by
  the setting `sourceOrder` ('addons-first' default | 'provider-first'). Torrent candidates use
  `Addons.torrentUrl(TORRENT_SERVER, s)`; `source` is that URL (so `exclude` works); `qualities` =
  `[s.quality]` when known. Add `kind: 'torrent'|'http'|'provider'` and `stats` (the stats URL for
  torrents) to the result. If `needsTranscode`, still return the plain URL for now (Module S's HLS
  endpoint is wired in after merge). Add-on lookups and the stream server run in parallel; one failing never
  blocks the other. No imdbId → stream server only.
- `web/index.html` loads `js/addons.js` before `js/pstream.js`.
- Settings (data.js defaults + settings.js rows): **Sources** section — "Source order" choice
  (Add-ons first / Stream server first), "Torrent server" status row (like Stream server: ping
  `<server>/settings` or `/`, show Connected/Not reachable). Add-on URLs come from
  `COUCH_SECRETS.addons` (array) else none; no on-screen editing.
- Player: optional `opts.status()` → `Promise<string>|string`, polled every 1 s while resolving or
  buffering and shown in the loader label (e.g. "Torrent · 23 peers · 41 %"); main.js supplies it from
  the stats URL for torrents. A torrent that shows no progress for 45 s fails like any playback error
  so `onFailure` moves to the next source.
- Keep watch history keyed by `video.url` (unchanged). Update tests; extend the mock in
  `mock-data.js` only if a screen needs new Data functions.

## v5 — Torrents on the TV itself (v0.6)

Torrents move from the laptop's Stremio server to a **.NET service app running on the TV**. The user
can't host a torrent server elsewhere, so the TV is the torrent client. The laptop server stays usable
as an override (`COUCH_SECRETS.torrentServer`) for development. Two modules are built in parallel on
branches off `v0.5-torrents`; **only edit the files you own**. All v2 rules still apply to `web/`.

### What the 2026-10-21 spike verified on this TV (Tizen 6.0, armv7, at 192.168.1.6)
- A Tizen .NET **service** app installs and runs: `~/.dotnet/dotnet` (SDK 8) +
  `Sdk="Tizen.NET.Sdk/1.1.9"`, `TargetFramework tizen80`, `LangVersion latest`. Re-sign with
  `~/tizen-studio/tools/ide/bin/tizen package -t tpk -s couch -- x.tpk`, install with
  `tizen install -n x.tpk -- <dir> -s 192.168.1.6:26101`, start with
  `~/tizen-studio/tools/sdb -s 192.168.1.6:26101 shell 0 execute <appid>`. Runtime: .NET 3.1.3, ARM.
- The service has outbound internet and a `TcpListener(IPAddress.Any, port)` is reachable from the LAN.
  **The web app can't fetch `127.0.0.1`/`localhost`** (Failed to fetch); it must use the TV's LAN IP.
- `tizen.application.launch('<service appid>')` from the web app failed with UnknownError; the web app's
  `config.xml` lacks `http://tizen.org/privilege/application.launch` (untested fix).
- The service's data dir (`Application.Current.DirectoryInfo.Data`, `/opt/usr/home/owner/apps_rw/<pkg>/data`)
  has **~1.7 GB free of 3.9 GB**. Movies are 1–10 GB, so whole files can't be stored.
- The TV has no logs or process list. The spike reported over HTTP to a laptop listener.
- MonoTorrent 3.0.2 (MIT, netstandard2.0) loads and runs on the TV. Metadata from a magnet: Sintel 11 s,
  Ubuntu 305 s (cold DHT); loading the `.torrent` file directly started at once with 15 peers. **Every
  run then froze** after 0.4–4 MB: all engine counters frozen, HTTP side still answering, a remove call
  blocking for > 90 s. Not caused by awaits resuming on the engine thread (tried). Suspect: file
  creation/preallocation of the full-size file on the TV's storage. The laptop's Stremio server fetched
  the same 100 MB (Ubuntu 24.04.4 ISO, info hash `01c137287d6f0ed05a56742dae794f632c79ff3d`, `.torrent` at
  `https://releases.ubuntu.com/24.04/ubuntu-24.04.4-desktop-amd64.iso.torrent`) in 39 s (2.7 MB/s).
- Spike source (reference only, copy what helps):
  `/tmp/claude-1000/-home-abhishek-couch-tv/bfd0c322-35e0-4b0b-b4fb-780ce2750e09/scratchpad/tvsvc/`.
- Unverified: Samsung says developer-installed .NET apps vanish on a TV cold boot.

### Service HTTP API (both modules code against this)
Same paths and fields as the Stremio server the app already uses (`docs/torrent-server.md`), so the
app keeps one code path. Port **11470** on the TV's LAN IP. Every response sends
`Access-Control-Allow-Origin: *`. Requests are accepted only from loopback and private LAN addresses
(127.0.0.0/8, 10/8, 172.16/12, 192.168/16).

| Request | Response |
|---|---|
| `GET /heartbeat` | `{"success":true}` |
| `GET /<infoHash>/<fileIdx>[?tr=<url>&tr=…]` | The file, `206` for `Range: bytes=a-b` / `a-` (`Content-Range`, `Accept-Ranges: bytes`), `200` without Range. `fileIdx -1` = the largest video file. Content-Type from the extension (mp4, mkv → `video/x-matroska`, avi, ts, webm). `tr` adds trackers. First request adds the torrent; a new request for the same file cancels the previous one's stream (AVPlay seeks by opening a new Range request). |
| `GET /<infoHash>/<fileIdx>/stats.json` | `{"peers":n,"downloadSpeed":bytes_per_s,"uploadSpeed":n,"downloaded":bytes,"streamLen":file_bytes,"streamProgress":0..1,"state":"metadata|downloading|error","error":""}` |
| `GET /<infoHash>/stats.json` | same without `stream*` |
| `GET /<infoHash>/remove` | `{}`; stops the torrent and deletes its cached pieces |
| `GET /stats.json` | `{ <infoHash>: stats, … }` |
| `GET /log` | `text/plain`, the last 300 log lines (the TV has no other way to see them) |

No HLS/transcoding on the TV (no ffmpeg): streams with DTS/TrueHD audio can't play there.

### Module V — TV torrent service (claude-work). Owns: `tv-service/**`, `docs/tv-torrent-service.md`
A Tizen .NET service app, package id **`CouchTor01`**, app id **`CouchTor01.Service`**, built from
`tv-service/` (keep the testable logic in a plain `netstandard2.0` library with laptop-runnable
`dotnet test` tests: Range parsing, the HTTP layer, cache eviction, the address filter).
Requirements, each **verified on the TV** and written up in `docs/tv-torrent-service.md`:
1. Implements the API above with MonoTorrent (or a better-fitting library if MonoTorrent can't be
   fixed; say why).
2. **No stall.** Find and fix the spike's freeze. Acceptance: on the TV, `curl -r 0-104857599` of the
   Ubuntu ISO through the service (magnet only, no `.torrent` file) completes at **≥ 1 MB/s average**
   from first byte, measured from the laptop, three runs.
3. **Bounded storage.** Pieces live in a cache capped at `min(1 GB, free space − 400 MB)`; least
   recently read pieces outside the window around the current read position are evicted, and
   re-downloaded if read again. Acceptance: read 100 MB at offsets 0, 3 GB and 5.5 GB of the 6 GB
   Ubuntu ISO, then 0 again; the data dir never exceeds the cap and the TV's free space never drops
   below 400 MB; bytes served match the laptop's copy (`sha256` of each range).
4. **Fast start.** Built-in public tracker list, DHT with its routing table saved in the data dir and
   reused on the next start, `tr` trackers honoured. Acceptance: Ubuntu by magnet answers the first
   byte in **≤ 20 s** on a cold start (after a service restart).
5. Torrents with no open stream for 2 minutes stop (cache kept until evicted); the service never
   seeds more than 64 KB/s. No crash leaves the service unable to answer `/heartbeat`.
6. Read-ahead tuned for playback: the pieces right after the read position download first.
7. `tv-service/build.sh` (or a documented `dotnet` command) builds and signs the `.tpk` with the
   `couch` profile; `docs/tv-torrent-service.md` says how to install, start, read `/log`, and the
   measured numbers (speed, start time, cache behaviour).
**Legal content only**: the Ubuntu ISO and the Sintel torrent. Never fetch anything else. Don't
install `CouchTV001` (the web app) and don't touch files outside `tv-service/` and the doc. The user
may be watching the TV: don't launch or kill the web app.

### Module A — app side (codex). Owns: `web/js/pstream.js`, `web/js/main.js`, `web/js/data.js`,
`web/js/addons.js`, `web/js/screens/settings.js`, `web/config.xml`, `build.sh`, `tests/test_pstream.js`,
`tests/test_data.js`, `tests/test_addons.js`, `docs/torrent-server.md`
- **Server base.** `COUCH_SECRETS.torrentServer` (e.g. `'http://192.168.1.34:11470'`) if set, else the TV
  service at `http://<TV IP>:11470`. Get the IP with `webapis.network.getIp()`, guarded (desktop has no
  `webapis`: fall back to `http://127.0.0.1:11470`). Never `localhost` on the TV.
- **Start the service.** At app start, if the base is the TV service and `GET /heartbeat` fails within 1 s,
  call `tizen.application.launch('CouchTor01.Service')` (guarded, errors swallowed) and keep pinging. Add
  `<tizen:privilege name="http://tizen.org/privilege/application.launch"/>` to `web/config.xml`.
  Playing a torrent waits up to 10 s for the heartbeat before treating the source as failed.
- **No transcoding on the TV.** When the base is the TV service, streams with `needsTranscode` are not
  candidates (no HLS there). With the laptop override, keep today's HLS behaviour.
- **Trackers.** `Addons.parse` keeps `trackers`: the `tracker:<url>` entries of raw `sources`
  (Torrentio's format); `torrentUrl` appends them as `?tr=` (encoded). Tests.
- **Status line** keeps working against the API above (fields unchanged); add "Starting torrent engine…"
  while waiting for the heartbeat.
- Settings > Sources: the "Torrent server" row shows "On this TV" or the override host, with
  Connected / Not reachable as now.
- `build.sh install` also builds, signs and installs `tv-service` when `tv-service/` exists (call its
  build script; skip with a message if `~/.dotnet/dotnet` is missing). Don't change the TV IP.
- Update `docs/torrent-server.md`: the laptop server is now the optional override; link to
  `docs/tv-torrent-service.md`.
- Desktop and unit tests only: **don't install on the TV**; the integrator runs the TV end-to-end test.
