// DataSource (CONTRACT.md): the TMDB catalog (via pstream.js) plus the local library — watch progress,
// My List, settings, recent searches — persisted in localStorage.
window.Data = (function () {
  var LIBRARY_KEY = 'couch.library.v2';
  var ROW_CACHE_KEY = 'couch.rows.v3';
  var ROW_CACHE_MS = 6 * 3600 * 1000;
  var MAX_SAVED_ITEMS = 60;
  // TMDB's plain popularity lists are full of talk shows, news and unreleased films that no provider
  // streams; discover with these filters keeps rows to things that can actually be played.
  var NO_TALK = { without_genres: '10763,10767' };
  var MOVIE_GENRES = [['28', 'Action'], ['35', 'Comedy'], ['18', 'Drama'], ['53', 'Thriller'],
    ['27', 'Horror'], ['878', 'Sci-Fi']];
  var SERIES_GENRES = [['18', 'Drama'], ['35', 'Comedy'], ['80', 'Crime'], ['10765', 'Sci-Fi'],
    ['16', 'Animation'], ['10764', 'Reality']];
  var ROWS = [
    { key: 'trending', title: 'Trending This Week', path: 'trending/all/week' },
    { key: 'popular-movies', title: 'Popular Movies', kind: 'movie', params: { 'vote_count.gte': 100 } },
    { key: 'popular-series', title: 'Popular Series', kind: 'tv', params: { 'vote_count.gte': 100 } },
    { key: 'hindi-movies', title: 'Hindi Movies', kind: 'movie', params: { with_original_language: 'hi', 'vote_count.gte': 20 } },
    { key: 'hindi-series', title: 'Hindi Series', kind: 'tv', params: { with_original_language: 'hi', 'vote_count.gte': 5 } },
    { key: 'top-movies', title: 'Top Rated Movies', kind: 'movie', params: { sort_by: 'vote_average.desc', 'vote_count.gte': 1000 } },
    { key: 'top-series', title: 'Top Rated Series', kind: 'tv', params: { sort_by: 'vote_average.desc', 'vote_count.gte': 500 } }
  ];

  var AIRING_KEY = 'couch.airing.v1'; // tmdb id -> { at, s, e, d }: each followed show's latest aired episode
  var AIRING_MS = 6 * 3600 * 1000;
  var NEW_DAYS = 30;

  var ART_KEY = 'couch.art.v2';
  var ART_MAX_AGE = 30 * 86400000;
  var ART_CONCURRENCY = 6;

  var listeners = [];
  var library = loadLibrary();
  var art = loadArt();       // id -> { l: logo path, b: textless backdrop path, at }
  var artQueue = [];
  var artActive = 0;
  var artPending = {};       // id -> Promise, so a title is looked up once however many rows show it
  var artSaveTimer = null;
  var because = null;        // { id: seed item id, promise } for becauseYouWatched
  var airing = loadJson(AIRING_KEY);
  var airingPending = null;

  function loadJson(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; }
  }

  function loadArt() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(ART_KEY)) || {}; } catch (e) { /* start fresh */ }
    var now = Date.now();
    Object.keys(saved).forEach(function (id) { if (now - saved[id].at > ART_MAX_AGE) delete saved[id]; });
    return saved;
  }

  // Caches from older versions (the archive catalog's rows, old artwork) only use up the ~5 MB storage
  // quota that progress saves need.
  ['couch.rows.v2', 'couch.art.v1', 'couch.progress'].forEach(function (k) {
    try { localStorage.removeItem(k); } catch (e) { /* unavailable storage */ }
  });

  function loadLibrary() {
    var lib = { progress: {}, items: {}, myList: [], recent: [], sports: [],
                settings: { autoplayNext: true, subtitles: false, subtitleSize: 'medium', quality: 'best', sourceOrder: 'addons-first', askSource: true, lastSource: 'torrent', noMotion: false, navClicks: true } };
    try {
      var saved = JSON.parse(localStorage.getItem(LIBRARY_KEY));
      if (saved) {
        for (var key in lib) if (saved[key] !== undefined && key !== 'settings') lib[key] = saved[key];
        for (var s in saved.settings || {}) lib.settings[s] = saved.settings[s];
      }
    } catch (e) { /* corrupt or unavailable storage: start fresh */ }
    // Internet Archive titles are no longer in the catalog; drop them from history and My List.
    var tmdb = function (id) { return String(id).indexOf('tmdb:') === 0; };
    lib.myList = lib.myList.filter(function (i) { return tmdb(i.id); });
    Object.keys(lib.items).forEach(function (id) { if (!tmdb(id)) delete lib.items[id]; });
    Object.keys(lib.progress).forEach(function (url) { if (!tmdb(lib.progress[url].itemId)) delete lib.progress[url]; });
    return lib;
  }

  function save() {
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)); } catch (e) { /* best effort */ }
    listeners.forEach(function (fn) { try { fn(); } catch (e) { console.warn(e); } });
  }

  // Time, resume and subtitle helpers (formerly the C++/WebAssembly core).
  function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '0:00';
    var value = Math.floor(seconds), hours = Math.floor(value / 3600);
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return hours ? hours + ':' + pad(Math.floor(value / 60) % 60) + ':' + pad(value % 60)
      : Math.floor(value / 60) + ':' + pad(value % 60);
  }

  // Under 30 s or over 95 % watched starts from the beginning; otherwise back up 5 s for context.
  function resumeFrom(positionSec, durationSec) {
    if (!isFinite(positionSec) || positionSec < 30 || (durationSec > 0 && positionSec > 0.95 * durationSec)) return 0;
    return positionSec - 5;
  }

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: '\u00a0' };
  function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, function (match, name) {
      if (ENTITIES[name.toLowerCase()] !== undefined) return ENTITIES[name.toLowerCase()];
      if (name.charAt(0) !== '#') return match;
      var code = name.charAt(1).toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
    });
  }

  // "01:02:03.500", "02:03,5" (SRT uses a comma); NaN when malformed.
  function timestamp(text) {
    var m = /^(?:(\d+):)?(\d+):(\d+)[.,](\d+)$/.exec(text);
    if (!m || +m[3] >= 60 || (m[1] !== undefined && +m[2] >= 60)) return NaN;
    return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4] / Math.pow(10, m[4].length);
  }

  // SRT or WebVTT -> [{start, end, text}] sorted by start; styling tags and {\an8} codes removed.
  function parseSubtitles(input) {
    var cues = [], block = [];
    function flush() {
      var lines = block;
      block = [];
      if (!lines.length || lines[0] === 'WEBVTT' || lines[0].indexOf('NOTE') === 0 ||
          lines[0] === 'STYLE' || lines[0] === 'REGION') return;
      var timing = lines[0].indexOf('-->') < 0 ? 1 : 0;
      if (timing >= lines.length || lines[timing].indexOf('-->') < 0) return;
      var parts = lines[timing].split('-->');
      var start = timestamp(parts[0].trim()), end = timestamp(parts[1].trim().split(/[ \t]/)[0]);
      if (!(end > start)) return;
      var text = lines.slice(timing + 1).map(function (line) {
        return decodeEntities(line.replace(/<[^>]*>?/g, '').replace(/\{\\[^}]*\}?/g, '')).trim();
      }).filter(Boolean).join('\n');
      if (text) cues.push({ start: start, end: end, text: text });
    }
    input.replace(/^\uFEFF/, '').split('\n').forEach(function (line) {
      line = line.replace(/\r$/, '').trim();
      if (line) block.push(line);
      else flush();
    });
    flush();
    return cues.sort(function (a, b) { return a.start - b.start; });
  }

  function today() { return new Date(Date.now()).toISOString().slice(0, 10); }

  // A discover query limited to released titles; kind is 'movie' or 'tv'.
  function discover(kind, params, page) {
    var date = kind === 'tv' ? 'first_air_date.lte' : 'primary_release_date.lte';
    var query = Object.assign({ sort_by: 'popularity.desc' }, kind === 'tv' ? NO_TALK : {}, params);
    query[date] = today();
    return PStream.list('discover/' + kind, query, page);
  }

  function fetchRow(row, page) {
    return row.path ? PStream.list(row.path, {}, page) : discover(row.kind, row.params, page);
  }

  // First pages of the Home rows are cached across launches so Home paints instantly on a cold start.
  var rowCache = null; // parsed once; every Home row used to re-parse the whole cache
  function cachedRow(row) {
    if (!rowCache) {
      try { rowCache = JSON.parse(localStorage.getItem(ROW_CACHE_KEY)) || {}; } catch (e) { rowCache = {}; }
    }
    var cache = rowCache;
    var hit = cache[row.key];
    if (hit && Date.now() - hit.at < ROW_CACHE_MS) return Promise.resolve(hit.result);
    return fetchRow(row, 1).then(function (result) {
      cache[row.key] = { at: Date.now(), result: result };
      try { localStorage.setItem(ROW_CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* best effort */ }
      return result;
    });
  }

  function tmdbImage(size, path) { return 'https://image.tmdb.org/t/p/' + size + path; }

  function applyArt(item) {
    var hit = art[item.id];
    if (!hit) return item;
    if (hit.b) {
      item.thumb = tmdbImage('w500', hit.b); // sharp at the 480px card size
      item.backdrop = tmdbImage('w1280', hit.b);
    }
    if (hit.l) {
      item.logo = tmdbImage('w300', hit.l);
      item.logoLarge = tmdbImage('w500', hit.l);
    }
    return item;
  }

  function saveArtSoon() {
    clearTimeout(artSaveTimer);
    artSaveTimer = setTimeout(function () {
      try { localStorage.setItem(ART_KEY, JSON.stringify(art)); } catch (e) { /* best effort */ }
    }, 1000);
  }

  function runArtJob(job) {
    artActive++;
    var parts = job.item.id.split(':'); // tmdb:<movie|tv>:<id>; saved My List entries keep only the id
    PStream.images({ mediaType: parts[1], tmdbId: parts[2], originalLanguage: job.item.originalLanguage }).then(function (found) {
      art[job.item.id] = { l: found.logo, b: found.backdrop, at: Date.now() };
      saveArtSoon();
    }, function () { /* offline or rate-limited: try again next time */ }).then(function () {
      artActive--;
      delete artPending[job.item.id];
      job.done();
      pumpArt();
    });
  }

  function pumpArt() {
    while (artActive < ART_CONCURRENCY && artQueue.length) runArtJob(artQueue.shift());
  }

  function lookupArt(item) {
    if (!artPending[item.id]) {
      artPending[item.id] = new Promise(function (resolve) {
        artQueue.push({ item: item, done: resolve });
        pumpArt();
      });
    }
    return artPending[item.id];
  }

  // Waits up to budgetMs for missing logos/backdrops, then shows whatever is known; lookups that
  // finish later are cached for next time.
  function withArt(result, budgetMs) {
    var now = Date.now();
    var missing = result.items.filter(function (i) {
      return String(i.id).indexOf('tmdb:') === 0 && (!art[i.id] || now - art[i.id].at > ART_MAX_AGE);
    });
    var done = Promise.all(missing.map(function (item) {
      return lookupArt(item).then(function () { applyArt(item); });
    }));
    var budget = new Promise(function (resolve) { setTimeout(resolve, budgetMs); });
    return Promise.race([done, budget]).then(function () {
      result.items.forEach(applyArt);
      return result;
    });
  }

  function rowByKey(key) {
    return ROWS.filter(function (r) { return r.key === key; })[0];
  }

  function summary(item) {
    return { id: item.id, title: item.title, year: item.year, description: item.description,
             thumb: item.thumb, rating: item.rating || 0, kind: item.kind };
  }

  function watched(p) {
    return p && resumeFrom(p.positionSec, p.durationSec) === 0 && p.positionSec >= 30;
  }

  function nextVideo(item, video) {
    var videos = item && item.videos;
    if (!videos || !video) return null;
    for (var i = 0; i < videos.length - 1; i++) if (videos[i].url === video.url) return videos[i + 1];
    return null;
  }

  // The furthest [season, episode] played of a series, from its progress URLs (pstream:show:<id>:<s>:<e>); starts
  // under 30 s (a stream that never played) don't count, as in Continue Watching.
  function furthest(itemId) {
    var best = null;
    Object.keys(library.progress).forEach(function (url) {
      if (library.progress[url].itemId !== itemId || !(library.progress[url].positionSec >= 30)) return;
      var parts = url.split(':').map(Number), at = [parts[3], parts[4]];
      if (isFinite(at[0]) && isFinite(at[1]) && (!best || at[0] > best[0] || (at[0] === best[0] && at[1] > best[1]))) best = at;
    });
    return best;
  }

  function inMyList(id) {
    return library.myList.some(function (i) { return i.id === id; });
  }

  function pruneItems() {
    var keep = {};
    Object.keys(library.progress).forEach(function (url) { keep[library.progress[url].itemId] = true; });
    var ids = Object.keys(library.items).filter(function (id) { return keep[id]; });
    ids.sort(function (a, b) { return (library.items[b].at || 0) - (library.items[a].at || 0); });
    var items = {};
    ids.slice(0, MAX_SAVED_ITEMS).forEach(function (id) { items[id] = library.items[id]; });
    library.items = items;
  }

  return {
    rows: ROWS.map(function (r) { return { key: r.key, title: r.title }; }),
    sections: [
      { key: 'movies', title: 'Movies', filters: [{ key: 'all', title: 'All' }, { key: 'hi', title: 'Hindi' }]
        .concat(MOVIE_GENRES.map(function (g) { return { key: g[0], title: g[1] }; })) },
      { key: 'series', title: 'Series', filters: [{ key: 'all', title: 'All' }, { key: 'hi', title: 'Hindi' }]
        .concat(SERIES_GENRES.map(function (g) { return { key: g[0], title: g[1] }; })) }
    ],
    sorts: [
      { key: 'popular', title: 'Popular' }, { key: 'top', title: 'Top Rated' },
      { key: 'newest', title: 'Newest' }, { key: 'title', title: 'A–Z' }
    ],

    loadRow: function (key, page) {
      var row = rowByKey(key);
      if (!row) return Promise.reject(new Error('Unknown row ' + key));
      return (page === 1 ? cachedRow(row) : fetchRow(row, page)).then(function (r) { return withArt(r, 0); });
    },

    // filterKey: 'all', 'hi' (Hindi originals) or a TMDB genre id.
    browse: function (sectionKey, filterKey, sortKey, page) {
      var kind = sectionKey === 'series' ? 'tv' : 'movie';
      var hindi = filterKey === 'hi';
      var params = { 'vote_count.gte': hindi ? 10 : 100 };
      if (hindi) params.with_original_language = 'hi';
      else if (filterKey !== 'all') params.with_genres = filterKey;
      if (sortKey === 'top') {
        params.sort_by = 'vote_average.desc';
        params['vote_count.gte'] = hindi ? 50 : 300;
      } else if (sortKey === 'newest') {
        params.sort_by = kind === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc';
        params['vote_count.gte'] = hindi ? 5 : 20;
      } else if (sortKey === 'title') {
        params.sort_by = kind === 'tv' ? 'name.asc' : 'title.asc';
      }
      return discover(kind, params, page).then(function (r) { return withArt(r, 0); });
    },

    search: function (text, page) {
      if (!text || !text.trim()) return Promise.resolve({ items: [], total: 0 });
      // No waiting while typing; logos found now show on the next search.
      return PStream.search(text.trim(), page).then(function (r) { return withArt(r, 0); });
    },

    loadItem: function (id) {
      return PStream.detail(id).then(function (item) {
        // A watched series' saved episode list only grows here: Continue Watching and Play then find new episodes.
        var saved = library.items[item.id];
        if (saved && saved.videos && item.videos && item.videos.length !== saved.videos.length) {
          saved.videos = item.videos;
          save();
        }
        return withArt({ items: [item] }, 1500).then(function () { return item; });
      });
    },

    personCredits: function (personId) {
      return PStream.personCredits(personId).then(function (list) { return withArt({ items: list.slice(0, 60) }, 800); })
        .then(function (r) { return r.items; });
    },

    // The trailer page the TV service serves (a YouTube player needs an http page around it; app pages are
    // file:// and YouTube refuses those); '' off the TV.
    trailerUrl: function (key) {
      var base = PStream.tvService();
      return base && key ? base + '/trailer.html?v=' + encodeURIComponent(key) : '';
    },

    related: function (item) {
      return PStream.related(item).then(function (items) {
        return withArt({ items: items.filter(function (i) { return i.id !== item.id; }).slice(0, 20) }, 1000);
      }).then(function (r) { return r.items; });
    },

    // Recommendations seeded by the most recently watched title: {title, items}, or null before
    // anything was watched. One request per seed; Home calls this on every library change.
    becauseYouWatched: function () {
      var seed = null;
      Object.keys(library.items).forEach(function (id) {
        if (!seed || (library.items[id].at || 0) > (seed.at || 0)) seed = library.items[id];
      });
      if (!seed || !seed.mediaType) return Promise.resolve(null);
      if (!because || because.id !== seed.id) {
        var related = this.related(seed);
        var entry = because = { id: seed.id, promise: related.then(function (items) {
          return { title: 'Because You Watched ' + seed.title, items: items };
        }) };
        related.catch(function () { if (because === entry) because = null; }); // retried on the next call
      }
      return because.promise;
    },

    loadSubtitles: function (url) {
      return fetch(url).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      }).then(parseSubtitles);
    },

    formatTime: formatTime,

    getProgress: function (url) {
      var p = library.progress[url];
      return p ? { positionSec: p.positionSec, durationSec: p.durationSec } : null;
    },

    resumeFrom: function (url) {
      var p = library.progress[url];
      return p ? resumeFrom(p.positionSec, p.durationSec) : 0;
    },

    nextVideo: nextVideo,

    // Called by main.js from the player. Keeps the item so Continue Watching needs no network.
    setProgress: function (item, video, positionSec, durationSec) {
      library.progress[video.url] = { positionSec: positionSec, durationSec: durationSec,
                                      at: Date.now(), itemId: item.id };
      var saved = {};
      for (var k in item) saved[k] = item[k];
      saved.at = Date.now();
      library.items[item.id] = saved;
      pruneItems();
      save();
    },

    // Newest first, one entry per title. A finished episode is replaced by the next one.
    continueWatching: function () {
      var latest = {};
      Object.keys(library.progress).forEach(function (url) {
        var p = library.progress[url];
        if (!latest[p.itemId] || p.at > latest[p.itemId].p.at) latest[p.itemId] = { url: url, p: p };
      });
      var entries = [];
      Object.keys(latest).forEach(function (id) {
        var item = library.items[id];
        if (!item || !item.videos) return;
        applyArt(item);
        var p = latest[id].p;
        var video = item.videos.filter(function (v) { return v.url === latest[id].url; })[0];
        if (!video) return;
        if (watched(p)) {
          var next = nextVideo(item, video);
          if (!next) return;
          entries.push({ item: item, video: next, positionSec: 0, durationSec: next.durationSec, at: p.at });
        } else if (p.positionSec >= 30) {
          entries.push({ item: item, video: video, positionSec: p.positionSec, durationSec: p.durationSec, at: p.at });
        }
      });
      entries.sort(function (a, b) { return b.at - a.at; });
      withArt({ items: entries.map(function (e) { return e.item; }) }, 0); // fills the cache for next time
      return entries;
    },

    // Followed series (My List, or watched and caught up, so not in Continue Watching) whose latest episode
    // aired in the last NEW_DAYS days and is ahead of what was played, newest first, as cards with a badge.
    // One light TMDB request per show, cached AIRING_MS; never rejects.
    newEpisodes: function () {
      var behind = {}, shows = {};
      this.continueWatching().forEach(function (e) { behind[e.item.id] = true; });
      library.myList.forEach(function (i) { if (i.kind === 'series' && !behind[i.id]) shows[i.id] = i; });
      Object.keys(library.items).forEach(function (id) {
        if (library.items[id].isSeries && !behind[id] && !shows[id] && furthest(id)) shows[id] = summary(library.items[id]);
      });
      var now = Date.now(), stale = Object.keys(shows).filter(function (id) { return !airing[id] || now - airing[id].at > AIRING_MS; });
      if (!airingPending && stale.length) {
        airingPending = Promise.all(stale.map(function (id) {
          return PStream.lastAired(id.split(':')[2]).then(function (last) {
            airing[id] = last ? { at: Date.now(), s: last.season, e: last.episode, d: last.airDate } : { at: Date.now() };
          }, function () { /* offline: the cached answer, if any, stands */ });
        })).then(function () {
          Object.keys(airing).forEach(function (id) { if (!shows[id]) delete airing[id]; });
          try { localStorage.setItem(AIRING_KEY, JSON.stringify(airing)); } catch (e) { /* best effort */ }
          airingPending = null;
        });
      }
      return Promise.resolve(airingPending).then(function () {
        var day = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
        var today = day(Date.now()), cutoff = day(Date.now() - NEW_DAYS * 86400000);
        var fresh = Object.keys(shows).filter(function (id) {
          var a = airing[id], played = furthest(id);
          return a && a.d && a.d >= cutoff && a.d <= today &&
            !(played && (played[0] > a.s || (played[0] === a.s && played[1] >= a.e)));
        });
        fresh.sort(function (a, b) { return airing[a].d < airing[b].d ? 1 : airing[a].d > airing[b].d ? -1 : 0; });
        var items = fresh.map(function (id) {
          return applyArt(Object.assign({}, shows[id], { badge: airing[id].e === 1 ? 'New Season' : 'New Episode' }));
        });
        withArt({ items: items }, 0);
        return items;
      });
    },

    removeFromContinue: function (itemId) {
      Object.keys(library.progress).forEach(function (url) {
        if (library.progress[url].itemId === itemId) delete library.progress[url];
      });
      pruneItems();
      save();
    },

    inMyList: inMyList,

    // Saved sports channels and matches, for the Sports screen and the Home launcher's My Sports row.
    // A match drops off 12 h after it starts; a channel stays until removed.
    sportsBookmarks: function () {
      var now = Date.now();
      return library.sports.filter(function (s) { return !(s.kind === 'event' && now - s.startsAt > 12 * 3600000); });
    },
    isSportsBookmark: function (id) {
      return library.sports.some(function (s) { return s.id === id; });
    },
    toggleSportsBookmark: function (item) {
      var had = this.isSportsBookmark(item.id);
      library.sports = this.sportsBookmarks().filter(function (s) { return s.id !== item.id; });
      if (!had) library.sports.unshift({ id: item.id, title: item.title, kind: item.kind, sport: item.sport || '',
        startsAt: item.startsAt || 0, thumb: item.thumb || '' });
      library.sports = library.sports.slice(0, 20);
      save();
      return !had;
    },
    // Keeps saved matches in step with the schedule (kick-off moved, title corrected).
    updateSportsBookmarks: function (items) {
      var changed = false;
      library.sports.forEach(function (s) {
        var item = items.filter(function (i) { return i.id === s.id; })[0];
        if (!item || (item.startsAt === s.startsAt && item.title === s.title)) return;
        s.startsAt = item.startsAt;
        s.title = item.title;
        s.thumb = item.thumb || s.thumb;
        changed = true;
      });
      if (changed) save();
    },

    toggleMyList: function (item) {
      var had = inMyList(item.id);
      library.myList = library.myList.filter(function (i) { return i.id !== item.id; });
      if (!had) library.myList.unshift(summary(item));
      save();
      return !had;
    },

    myList: function () {
      var items = library.myList.map(applyArt);
      withArt({ items: items }, 0);
      return items;
    },

    settings: function () {
      var copy = {};
      for (var k in library.settings) copy[k] = library.settings[k];
      return copy;
    },

    setSetting: function (key, value) { library.settings[key] = value; save(); },

    // Forgets cached Home rows and logos/backdrops; they are fetched again on the next visit.
    clearCache: function () {
      art = {};
      rowCache = null;
      try { localStorage.removeItem(ROW_CACHE_KEY); localStorage.removeItem(ART_KEY); } catch (e) { /* best effort */ }
    },

    // The Home launcher's sleep timer (its boot service on this TV): minutes sets it (0 cancels), none reads it.
    // Resolves { endsAt } (0 = off); { down: true } when the launcher's service isn't there.
    sleepTimer: function (minutes) {
      var set = typeof minutes === 'number';
      return fetch('http://127.0.0.1:8737/sleep' + (set ? '?minutes=' + minutes : ''), set ? { method: 'POST' } : {})
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .catch(function () { return { endsAt: 0, down: true }; });
    },

    serverStatus: function (torrent) { return PStream.ping(torrent); },

    // Optional COUCH_SECRETS.playlists: M3U URLs (provider playlists can carry credentials).
    liveChannels: function () { return Live.channels(window.COUCH_SECRETS && window.COUCH_SECRETS.playlists); },
    // Sports schedules and streams come from the relay set in COUCH_SECRETS.sportsRelay (or a …/live.m3u
    // playlist); without one, only the channels in the playlists.
    sports: function () {
      var config = window.COUCH_SECRETS || {};
      return Live.sports(config.playlists, config.sportsRelay || '');
    },

    // The sports relay's schedule and resolver state (Live.health reads it); test resolves an on-air feed
    // first, which can take most of a minute. Never rejects: null without a relay, { down: true } without an answer.
    sportsHealth: function (test) {
      var config = window.COUCH_SECRETS || {};
      var base = (config.sportsRelay || '').replace(/\/$/, '');
      if (!base) return Promise.resolve(null);
      return Promise.resolve().then(function () {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, test ? 70000 : 4000);
        return fetch(base + '/sports/health' + (test ? '?test=1' : ''), { signal: controller.signal }).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        }).catch(function () { return { down: true }; }).then(function (health) {
          clearTimeout(timer);
          return health;
        });
      });
    },

    // Last 20 uncaught errors, kept on the TV (it has no console) and shown in Settings > App health.
    recordError: function (message) {
      var log = this.errors();
      log.unshift({ at: Date.now(), message: String(message).slice(0, 200) });
      try { localStorage.setItem('couch.errors', JSON.stringify(log.slice(0, 20))); } catch (e) { /* best effort */ }
    },
    errors: function () {
      try { return JSON.parse(localStorage.getItem('couch.errors')) || []; } catch (e) { return []; }
    },
    clearErrors: function () {
      try { localStorage.removeItem('couch.errors'); } catch (e) { /* best effort */ }
    },

    clearHistory: function () { library.progress = {}; library.items = {}; save(); },
    clearMyList: function () { library.myList = []; save(); },

    recentSearches: function () { return library.recent.slice(); },

    addRecentSearch: function (text) {
      text = (text || '').trim();
      if (!text) return;
      library.recent = [text].concat(library.recent.filter(function (r) {
        return r.toLowerCase() !== text.toLowerCase();
      })).slice(0, 8);
      save();
    },

    clearRecentSearches: function () { library.recent = []; save(); },

    // Resolving a provider stream takes a few seconds; asking while the details screen is open warms
    // the provider's cache so Play starts right away.
    prefetch: function (item, video) {
      if (item.source === 'pstream' && video) PStream.scrape(item, video).catch(function () {});
    },

    play: function () {}, // set by main.js

    onChange: function (fn) { listeners.push(fn); }
  };
})();
