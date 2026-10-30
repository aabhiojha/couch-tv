(function () {
  'use strict';
  var rows = [
    { key: 'feature_films', title: 'Classic Films' },
    { key: 'classic_tv', title: 'Classic TV' },
    { key: 'silent_and_cult', title: 'Silent & Cult Favorites' }
  ];
  var sections = [
    {
      key: 'movies',
      title: 'Movies',
      filters: [
        { key: 'all', title: 'All' },
        { key: 'feature_films', title: 'Classics' },
        { key: 'silent_and_cult', title: 'Silent & Cult' }
      ]
    },
    {
      key: 'series',
      title: 'Series',
      filters: [
        { key: 'all', title: 'All' },
        { key: 'classic_tv', title: 'Classic TV' },
        { key: 'western', title: 'Westerns' }
      ]
    }
  ];
  var sorts = [
    { key: 'popular', title: 'Popular' },
    { key: 'newest', title: 'Newest' },
    { key: 'oldest', title: 'Oldest' },
    { key: 'title', title: 'A–Z' }
  ];
  var seed = [
    [
      'His Girl Friday',
      'House on Haunted Hill',
      'The Stranger',
      'The Jungle Book',
      'Sita Sings the Blues',
      'Reefer Madness',
      'Suddenly',
      'The Pied Piper of Hamelin',
      'Dressed to Kill',
      'The General',
      'The Gold Rush',
      'Night of the Living Dead'
    ],
    [
      'The Lone Ranger',
      'Bonanza',
      'The Adventures of Sherlock Holmes',
      'The Lucy Show',
      'You Bet Your Life',
      'The Beverly Hillbillies',
      'Cavalcade of Stars',
      'Classic Western Hour',
      'Tate',
      'The Cisco Kid',
      'The Adventures of Ozzie and Harriet',
      'The Abbott and Costello Show'
    ],
    [
      'The Cabinet of Dr. Caligari',
      'A Trip to the Moon',
      'The Kid',
      'The Phantom of the Opera',
      'Nosferatu',
      'The Last Man on Earth',
      'Metropolis',
      'The Little Shop of Horrors',
      'The 39 Steps',
      'The Brain That Wouldn’t Die',
      'The Lost World',
      'The Phantom Planet'
    ]
  ];
  var realIds = [
    [
      'his_girl_friday',
      'house_on_haunted_hill_ipod',
      'TheStranger_0',
      'JungleBook',
      'Sita_Sings_the_Blues',
      'reefer_madness1938'
    ],
    ['theloneranger_201705', 'Bonanza_pd', 'SherlockHolmes1954', 'TheLucyShow'],
    ['caligari', 'trip_to_the_moon', 'the_kid', 'phantom_of_the_opera']
  ];
  var descriptions = [
    'A sharp, fast talking reporter is drawn back into one last story by an editor who knows her too well. A sparkling classic comedy for a long evening in.',
    'The adventures, mysteries and familiar faces of classic television, ready for another episode on the couch.',
    'A landmark of early cinema, full of atmosphere, striking images and stories that still feel fresh.'
  ];
  var catalog = {},
    all = [],
    progress = {},
    saved = [],
    sportsSaved = [],
    recent = [],
    listeners = [];
  var prefs = { autoplayNext: true, subtitles: false, subtitleSize: 'medium' },
    failureUsed = false;
  for (var r = 0; r < rows.length; r++) {
    catalog[rows[r].key] = [];
    for (var i = 0; i < 48; i++) {
      var title =
        seed[r][i % seed[r].length] +
        (i >= seed[r].length ? ' · Collection ' + (Math.floor(i / seed[r].length) + 1) : '');
      var id = i < realIds[r].length ? realIds[r][i] : rows[r].key + '_' + i;
      var item = {
        id: id,
        title: title,
        year: String(1921 + ((i * 7 + r * 11) % 46)),
        description: descriptions[r],
        thumb: 'https://archive.org/services/img/' + id,
        rating: i % 7 === 0 ? 0 : Math.round((3.2 + (i % 17) / 10) * 10) / 10
      };
      catalog[rows[r].key].push(item);
      all.push(item);
    }
  }
  function delay(value, fail) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (fail) reject(new Error('Mock network failure'));
        else resolve(value);
      }, 300);
    });
  }
  function notify() {
    for (var i = 0; i < listeners.length; i++) listeners[i]();
  }
  function find(id) {
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function inSeries(item) {
    return !!item && catalog.classic_tv.indexOf(item) >= 0;
  }
  function detail(item) {
    var series = inSeries(item),
      videos = [],
      count = series ? 18 : 1;
    for (var i = 0; i < count; i++) {
      var season = series ? Math.floor(i / 9) + 1 : 0,
        episode = series ? (i % 9) + 1 : 0;
      var filename = series ? 's' + season + 'e' + episode + '.mp4' : item.id + '.mp4';
      videos.push({
        name: filename,
        title: series
          ? 'Episode ' +
            episode +
            ': ' +
            ['A New Adventure', 'The Long Road', 'A Stranger Arrives'][i % 3]
          : item.title,
        url: 'https://archive.org/download/' + item.id + '/' + filename,
        durationSec: series ? 1520 + i * 23 : 5520,
        description: series ? 'Our heroes face a new problem when a stranger rides into town with a secret.' : '',
        season: season,
        episode: episode,
        subtitles: [
          {
            label: 'English (auto)',
            url:
              'https://archive.org/download/' + item.id + '/' + filename.replace('.mp4', '.asr.vtt')
          }
        ]
      });
    }
    return {
      id: item.id,
      title: item.title,
      year: item.year,
      description: item.description,
      thumb: item.thumb,
      rating: item.rating,
      videos: videos,
      isSeries: series,
      runtime: series ? '' : '1h 32m',
      creator: series ? 'Classic Television Archives' : 'Independent filmmakers',
      subjects: series
        ? ['Television', 'Adventure', 'Classic']
        : ['Classic Film', 'Drama', 'Public Domain'],
      language: 'English'
    };
  }
  function page(list, number) {
    return { items: list.slice((number - 1) * 20, number * 20), total: list.length };
  }
  function formatTime(seconds) {
    var n = Math.max(0, Math.floor(Number(seconds) || 0)),
      s = String(n % 60);
    if (s.length < 2) s = '0' + s;
    var m = Math.floor(n / 60);
    if (m < 60) return m + ':' + s;
    var mm = String(m % 60);
    if (mm.length < 2) mm = '0' + mm;
    return Math.floor(m / 60) + ':' + mm + ':' + s;
  }
  function filtered(section, filter, sort) {
    var list = (
      section === 'series'
        ? catalog.classic_tv
        : catalog.feature_films.concat(catalog.silent_and_cult)
    ).slice();
    if (filter === 'feature_films' || filter === 'silent_and_cult' || filter === 'classic_tv')
      list = catalog[filter].slice();
    if (filter === 'western')
      list = list.filter(function (item, i) {
        return i % 2 === 0;
      });
    if (sort === 'newest')
      list.sort(function (a, b) {
        return Number(b.year) - Number(a.year);
      });
    if (sort === 'oldest')
      list.sort(function (a, b) {
        return Number(a.year) - Number(b.year);
      });
    if (sort === 'title')
      list.sort(function (a, b) {
        return a.title.localeCompare(b.title);
      });
    return list;
  }
  function playing(item, video) {
    if (!video) return;
    progress[video.url] = {
      positionSec: Math.min(914, video.durationSec / 2),
      durationSec: video.durationSec,
      item: item,
      video: video,
      when: Date.now()
    };
    notify();
    if (window.Shell) window.Shell.toast('Now playing: ' + (video.title || item.title));
  }
  function seedProgress(item, episode, positionSec, minutesAgo) {
    var fullItem = detail(item);
    var video = fullItem.videos[episode];
    progress[video.url] = {
      positionSec: positionSec,
      durationSec: video.durationSec,
      item: fullItem,
      video: video,
      when: Date.now() - minutesAgo * 60000
    };
  }
  saved = [catalog.feature_films[0], catalog.classic_tv[0], catalog.silent_and_cult[0]];
  seedProgress(catalog.feature_films[0], 0, 1830, 3);
  seedProgress(catalog.classic_tv[0], 1, 612, 14);
  seedProgress(catalog.classic_tv[1], 4, 1088, 45);
  window.Data = {
    rows: rows,
    sections: sections,
    sorts: sorts,
    loadRow: function (key, number) {
      if (key === 'classic_tv' && number === 2 && !failureUsed) {
        failureUsed = true;
        return delay(null, true);
      }
      return delay(page(catalog[key] || [], number));
    },
    browse: function (section, filter, sort, number) {
      return delay(page(filtered(section, filter, sort), number));
    },
    search: function (query, number) {
      var q = String(query || '')
        .toLowerCase()
        .trim();
      if (!q) return delay({ items: [], total: 0 });
      return delay(
        page(
          all.filter(function (item) {
            return (item.title + ' ' + item.description).toLowerCase().indexOf(q) >= 0;
          }),
          number
        )
      );
    },
    loadItem: function (id) {
      var item = find(id);
      var full = item ? Object.assign(detail(item), { certification: 'U/A 13+',
        cast: ['Rosalind Russell', 'Cary Grant', 'Ralph Bellamy'].map(function (name, i) {
          return { id: 'person:' + i, personId: String(i), title: name, meta: 'Demo role', kind: 'person', thumb: '', fallback: name.split(' ').map(function (w) { return w.charAt(0); }).join('') };
        }) }) : null;
      return delay(full, !item);
    },
    personCredits: function () { return delay(all.slice(0, 9)); },
    trailerUrl: function () { return ''; },
    related: function (item) {
      return delay(
        all
          .filter(function (entry) {
            return entry.id !== item.id;
          })
          .slice(0, 20)
      );
    },
    becauseYouWatched: function () {
      var latest = this.continueWatching()[0];
      if (!latest) return delay(null);
      return this.related(latest.item).then(function (items) {
        return { title: 'Because You Watched ' + latest.item.title, items: items };
      });
    },
    loadSubtitles: function () {
      return delay([
        { start: 1, end: 4, text: 'Welcome to Couch TV.' },
        { start: 5, end: 8, text: 'The story begins here.' }
      ]);
    },
    formatTime: formatTime,
    getProgress: function (url) {
      var p = progress[url];
      return p ? { positionSec: p.positionSec, durationSec: p.durationSec } : null;
    },
    resumeFrom: function (url) {
      var p = progress[url];
      return p && p.positionSec >= 30 && p.positionSec < p.durationSec * 0.95 ? p.positionSec : 0;
    },
    nextVideo: function (item, video) {
      var i = item.videos.indexOf(video);
      return i >= 0 ? item.videos[i + 1] || null : null;
    },
    continueWatching: function () {
      var result = [];
      for (var url in progress)
        if (Object.prototype.hasOwnProperty.call(progress, url)) {
          var p = progress[url];
          if (p.positionSec > 0 && p.positionSec < p.durationSec * 0.95)
            result.push({
              item: p.item,
              video: p.video,
              positionSec: p.positionSec,
              durationSec: p.durationSec,
              when: p.when
            });
        }
      result.sort(function (a, b) {
        return b.when - a.when;
      });
      return result;
    },
    removeFromContinue: function (id) {
      for (var url in progress)
        if (Object.prototype.hasOwnProperty.call(progress, url) && progress[url].item.id === id)
          delete progress[url];
      notify();
    },
    inMyList: function (id) {
      return saved.some(function (item) {
        return item.id === id;
      });
    },
    toggleMyList: function (item) {
      var index = saved
        .map(function (entry) {
          return entry.id;
        })
        .indexOf(item.id);
      if (index >= 0) saved.splice(index, 1);
      else saved.unshift(item);
      notify();
      return index < 0;
    },
    myList: function () {
      return saved.slice();
    },
    serverStatus: function () { return Promise.resolve({ ok: true, host: 'Demo server', ms: 1 }); },
    settings: function () {
      return {
        autoplayNext: prefs.autoplayNext,
        subtitles: prefs.subtitles,
        sourceOrder: prefs.sourceOrder || 'addons-first',
        askSource: prefs.askSource !== false,
        lastSource: prefs.lastSource || 'torrent',
        subtitleSize: prefs.subtitleSize,
        navClicks: prefs.navClicks !== false
      };
    },
    // Features served by the TV (its service, the Home launcher) have nothing behind them in the preview.
    newEpisodes: function () { return Promise.resolve([]); },
    sportsBookmarks: function () { return sportsSaved.slice(); },
    isSportsBookmark: function (id) { return sportsSaved.some(function (s) { return s.id === id; }); },
    toggleSportsBookmark: function (item) {
      var had = this.isSportsBookmark(item.id);
      sportsSaved = sportsSaved.filter(function (s) { return s.id !== item.id; });
      if (!had) sportsSaved.unshift(item);
      notify();
      return !had;
    },
    updateSportsBookmarks: function () {},
    sportsHealth: function () { return Promise.resolve(null); },
    sleepTimer: function () { return Promise.resolve({ endsAt: 0, down: true }); },
    setSetting: function (key, value) {
      prefs[key] = value;
      notify();
    },
    clearHistory: function () {
      progress = {};
      notify();
    },
    clearMyList: function () {
      saved = [];
      notify();
    },
    errors: function () { return []; },
    recordError: function () {},
    clearErrors: function () {},
    recentSearches: function () {
      return recent.slice();
    },
    addRecentSearch: function (query) {
      query = String(query || '').trim();
      if (!query) return;
      recent = recent.filter(function (entry) {
        return entry.toLowerCase() !== query.toLowerCase();
      });
      recent.unshift(query);
      recent = recent.slice(0, 8);
    },
    clearRecentSearches: function () {
      recent = [];
    },
    // Synthetic Sports fixtures for navigation and failure-state checks; no playable media is implied.
    sports: function () {
      var now = Date.now(), hour = 3600000;
      function event(id, title, sport, starts, ends, languages) {
        return { id: id, title: title, kind: 'event', sport: sport, startsAt: now + starts * hour,
          endsAt: ends ? now + ends * hour : 0, thumb: '', streams: languages.map(function (lang, i) {
            return { url: 'https://example.invalid/' + id + '/' + i, label: 'Demo feed ' + (i + 1), language: lang };
          }) };
      }
      return delay({ items: [
        event('demo:cricket', 'Nepal vs India — demo fixture', 'Cricket', -0.5, 3, ['en', 'hi', 'ne']),
        Object.assign(event('demo:football', 'Arsenal vs Chelsea — demo fixture', 'Football', -1, 1, ['en', 'es']),
          { score: { state: 'in', line: "ARS 2 – 1 CHE · 67'", summary: '', crests: [] } }),
        event('demo:upcoming', 'Nepal vs Bangladesh — demo fixture', 'Cricket', 3, 7, ['hi', 'ne']),
        event('demo:tomorrow', 'Liverpool vs Arsenal — demo fixture', 'Football', 26, 28, ['en']),
        event('demo:open', 'Pakistan vs Sri Lanka — demo fixture, no listed end', 'Cricket', -0.25, 0, ['']),
        event('demo:ended', 'Nepal vs UAE — demo fixture', 'Cricket', -9, -1, ['en']),
        { id: 'demo:channel', title: 'Sports channel — demo', kind: 'channel', sport: 'Cricket', startsAt: 0, endsAt: 0, scheduled: true,
          thumb: '', streams: [{ url: 'https://example.invalid/demo-channel', label: 'Demo channel', language: '' }] }
      ], providers: [{ name: 'Demo data', status: 'ok', updatedAt: now }], message: 'Desktop preview · Synthetic sports fixtures',
      stale: false, scheduleError: false, updatedAt: now });
    },
    playLive: function (item, options) {
      if (window.Shell) window.Shell.toast((options && options.direct ? 'Demo play: ' : 'Demo watch options: ') + item.title);
    },
    play: playing,
    onChange: function (fn) {
      listeners.push(fn);
    }
  };
})();
