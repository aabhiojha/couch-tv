// Sports schedules from the LAN relay, plus channels from configured M3U playlists.
(function (root) {
  'use strict';
  var DEFAULT_PLAYLISTS = ['https://iptv-org.github.io/iptv/categories/sports.m3u'];
  function parse(text) {
    var channels = [], info = null;
    String(text).split(/\r?\n/).forEach(function (line) {
      line = line.trim();
      if (line.indexOf('#EXTINF') === 0) {
        var attrs = {};
        line.replace(/([\w-]+)="([^"]*)"/g, function (all, name, value) { attrs[name] = value; return ''; });
        var bare = line.replace(/([\w-]+)="([^"]*)"/g, '');
        var country = /\.([a-z]{2})(?:@|$)/i.exec(attrs['tvg-id'] || '');
        // iptv-org lists several categories ("Outdoor;Sports"); the sports one is the one that matters here.
        var parts = (attrs['group-title'] || '').split(';');
        info = { title: bare.slice(bare.indexOf(',') + 1).trim() || attrs['tvg-name'] || 'Channel',
          thumb: attrs['tvg-logo'] || '', group: parts.filter(function (g) { return /sport/i.test(g); })[0] || parts[0] || 'Other',
          country: country ? country[1].toUpperCase() : '', source: attrs['couch-source'] || '' };
        if (attrs['tvg-language']) info.language = language(attrs['tvg-language']);
      } else if (info && line && line[0] !== '#') {
        // Xtream m3u_plus playlists also list films and series; only live channels belong here.
        if (!/\/(?:movie|series)\//.test(line)) channels.push(Object.assign(info, { id: 'live:' + line, url: line }));
        info = null;
      }
    });
    return channels;
  }
  function fetchText(url) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    return fetch(url, { signal: controller.signal }).then(function (response) {
      if (!response.ok) throw new Error('Playlist HTTP ' + response.status);
      return response.text();
    }).then(function (text) { clearTimeout(timer); return text; }, function (error) { clearTimeout(timer); throw error; });
  }
  // "Star Sports 1 HD (1080p) [Geo-blocked]" and "Star Sports 1 (720p)" are one channel.
  function key(title) {
    return title.replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/\b(?:hd|sd|fhd|uhd)\b/gi, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  // Same-named channels from every playlist become one channel with a list of streams to pick from,
  // each labelled with its source ("PPV · SkyCast", "iptv-org · 1080p · Geo-blocked").
  function merge(list, sources) {
    var byKey = Object.create(null), all = [];
    list.forEach(function (c) {
      var notes = (c.title.match(/\(([^)]*)\)|\[([^\]]*)\]/g) || []).map(function (n) { return n.slice(1, -1); });
      var label = [c.source || sources[c.url]].concat(notes).filter(Boolean).join(' · ');
      var stream = { url: c.url, label: label || 'Stream' };
      if (c.language) stream.language = c.language;
      var k = key(c.title) || c.url, channel = byKey[k];
      if (channel) {
        channel.streams.push(stream);
        channel.thumb = channel.thumb || c.thumb;
        return;
      }
      channel = byKey[k] = Object.assign({}, c, { id: 'live:' + k, title: c.title.replace(/\s*(?:\([^)]*\)|\[[^\]]*\])/g, '') || c.title, streams: [stream] });
      all.push(channel);
    });
    return all;
  }
  // Streams without a couch-source attribute are named after their playlist's host: iptv-org.github.io → "iptv-org".
  function sourceName(url) {
    return ((/^\w+:\/\/([^/:]+)/.exec(url) || [])[1] || '').replace(/^www\./, '').split('.')[0];
  }
  var cached = null;
  // All playlists merged, duplicates (same stream URL) dropped; fails only if every playlist fails.
  function channels(urls) {
    if (cached) return cached;
    var lists = Array.isArray(urls) && urls.length ? urls : DEFAULT_PLAYLISTS;
    cached = Promise.all(lists.map(function (url) {
      return fetchText(url).then(parse, function () { return null; });
    })).then(function (results) {
      var seen = {}, all = [], sources = {};
      results.forEach(function (list, i) {
        (list || []).forEach(function (c) {
          if (!seen[c.url]) { seen[c.url] = true; sources[c.url] = sourceName(lists[i]); all.push(c); }
        });
      });
      if (!all.length && results.every(function (list) { return !list; })) throw new Error("Couldn't load channels");
      return merge(all, sources);
    });
    cached.catch(function () { cached = null; });
    return cached;
  }
  // Tabs: All, then the playlist's groups by size; a single-group list (iptv-org) is split by country.
  function groups(list) {
    var field = list.some(function (c) { return c.group !== list[0].group; }) ? 'group' : 'country';
    var counts = {};
    list.forEach(function (c) { if (c[field]) counts[c[field]] = (counts[c[field]] || 0) + 1; });
    return [{ key: 'all', title: 'All', field: field }].concat(Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || (a < b ? -1 : 1);
    }).map(function (key) { return { key: key, title: key, field: field }; }));
  }
  function language(value) {
    var name = String(value || '').toLowerCase().replace('_', '-').split('-')[0].trim();
    return { english: 'en', hindi: 'hi', nepali: 'ne', eng: 'en', hin: 'hi', nep: 'ne' }[name] || name;
  }
  function languageName(value) {
    var code = language(value);
    return { en: 'English', hi: 'Hindi', ne: 'Nepali' }[code] || code || 'Unspecified';
  }
  function preferredStreams(list, preference) {
    return (list || []).filter(function (stream) {
      var code = language(stream.language);
      return preference === 'all' || (preference && preference !== 'preferred' ? code === preference :
        !code || ['en', 'hi', 'ne'].indexOf(code) >= 0);
    }).slice().sort(function (a, b) {
      var order = ['en', 'hi', 'ne', ''];
      var left = order.indexOf(language(a.language)), right = order.indexOf(language(b.language));
      return (left < 0 ? 4 : left) - (right < 0 ? 4 : right);
    });
  }
  function relayUrl(urls, explicit) {
    if (explicit && /^https?:\/\//i.test(explicit)) return explicit.replace(/\/$/, '') + '/sports.json';
    var playlist = (urls || []).filter(function (url) { return /^https?:\/\/[^?#]+\/live\.m3u(?:\?|$)/i.test(url); })[0];
    return playlist ? playlist.replace(/\/live\.m3u(?:\?.*)?$/, '/sports.json') : '';
  }
  function readCatalog(data) {
    if (!data || !Array.isArray(data.items) || !Array.isArray(data.providers)) throw new Error('Invalid sports catalog');
    return { providers: data.providers.filter(function (provider) {
      return provider && typeof provider.name === 'string' && ['ok', 'stale', 'unavailable'].indexOf(provider.status) >= 0;
    }), items: data.items.filter(function (item) {
      return item && typeof item.id === 'string' && typeof item.title === 'string' &&
        (item.kind === 'channel' || (item.kind === 'event' && Number.isFinite(item.startsAt) && item.startsAt > 0)) &&
        Array.isArray(item.streams);
    }).map(function (item) {
      var score = item.score && typeof item.score.line === 'string' ? { state: item.score.state === 'in' ? 'in' : 'post',
        line: item.score.line, summary: String(item.score.summary || ''),
        crests: (item.score.crests || []).filter(function (c) { return typeof c === 'string' && /^https:\/\//.test(c); }) } : null;
      return Object.assign({}, item, { score: score, sport: typeof item.sport === 'string' ? item.sport : 'Other',
        endsAt: Number.isFinite(item.endsAt) && item.endsAt > item.startsAt ? item.endsAt : 0,
        streams: item.streams.filter(function (stream) {
        return stream && typeof stream.url === 'string' && /^https?:\/\//i.test(stream.url);
      }).map(function (stream) {
        return { url: stream.url, label: String(stream.label || 'Stream'), language: language(stream.language) };
      }) });
    }) };
  }
  function mergeChannels(list) {
    var all = [], byName = Object.create(null);
    list.forEach(function (channel) {
      var name = key(channel.title), existing = byName[name];
      if (!existing) {
        existing = byName[name] = Object.assign({}, channel, { kind: 'channel', sport: channel.sport || channel.group || 'Other',
          startsAt: 0, endsAt: 0, streams: [] });
        all.push(existing);
      }
      (channel.streams || []).forEach(function (stream) {
        if (!existing.streams.some(function (old) { return old.url === stream.url; })) existing.streams.push(stream);
      });
      existing.thumb = existing.thumb || channel.thumb;
    });
    return all;
  }
  // The household watches cricket and football (soccer) only. Catalog items carry their sport; playlist
  // channels (iptv-org files everything under "Sports") are recognised by name, and the rest are left out.
  var SPORTS = ['Cricket', 'Football'];
  var CRICKET = /cricket|willow|star sports|sony (?:six|ten)|\bten sports|ptv sports|\bt sports|\ba sports|gazi tv|kantipur max/i;
  var FOOTBALL = /football|soccer|f[uú]tbol|calcio|premier league|la ?liga|serie a|bundesliga|ligue 1|\bbein|\bmutv|lfc tv|chelsea tv|real madrid tv|bar[cç]a|eleven sports|tudn|golazo|^sport tv\b/i;
  function sportOf(item) {
    if (SPORTS.indexOf(item.sport) >= 0) return item.sport;
    if (item.sport || item.kind === 'event') return '';
    if (CRICKET.test(item.title)) return 'Cricket';
    return FOOTBALL.test(item.title) && !/american|aussie|footy|nfl|\bafl\b/i.test(item.title) ? 'Football' : '';
  }
  function onlyOurSports(list) {
    return list.map(function (item) { return Object.assign({}, item, { sport: sportOf(item) }); })
      .filter(function (item) { return item.sport; });
  }
  // A good catalog is reused for a minute; a failed one is retried after 10 s (the relay may just be starting).
  var sportsPending = null, sportsAt = 0, sportsTtl = 60000, lastCatalog = null, lastCatalogAt = 0;
  function sports(urls, explicit) {
    if (sportsPending && Date.now() - sportsAt < sportsTtl) return sportsPending;
    var endpoint = relayUrl(urls, explicit);
    var playlists = (Array.isArray(urls) && urls.length ? urls : DEFAULT_PLAYLISTS).filter(function (url) {
      return !/\/live\.m3u(?:\?|$)/i.test(url);
    });
    var request = endpoint ? fetchText(endpoint).then(function (text) {
      var result = readCatalog(JSON.parse(text));
      lastCatalog = result;
      lastCatalogAt = Date.now();
      return result;
    }, function () { return null; }).catch(function () { return null; }) : Promise.resolve(null);
    sportsAt = Date.now();
    sportsPending = Promise.all([request, playlists.length ? channels(playlists).catch(function () { return null; }) : Promise.resolve([])])
      .then(function (results) {
        var catalog = results[0], stale = false;
        sportsTtl = catalog || !endpoint ? 60000 : 10000;
        if (!catalog && lastCatalog && Date.now() - lastCatalogAt < 6 * 3600000) { catalog = lastCatalog; stale = true; }
        if (!catalog && results[1] === null) throw new Error('Sports and channels unavailable');
        var all = catalog ? onlyOurSports(catalog.items) : [], providers = catalog ? catalog.providers : [];
        var old = stale || providers.some(function (provider) { return provider.status !== 'ok'; });
        var scheduled = all.filter(function (item) { return item.kind === 'channel'; }).map(function (item) {
          return Object.assign({}, item, { scheduled: true });
        });
        return { items: all.filter(function (item) { return item.kind === 'event'; }).concat(
          mergeChannels(scheduled.concat(onlyOurSports((results[1] || []).map(function (channel) {
            return Object.assign({}, channel, { kind: 'channel', sport: '' });
          }))))),
          providers: providers, stale: old, scheduleError: !catalog || stale,
          updatedAt: providers.reduce(function (oldest, provider) {
            return provider.updatedAt > 0 ? Math.min(oldest, provider.updatedAt) : oldest;
          }, lastCatalogAt),
          message: !catalog ? (endpoint ? 'Schedules unavailable. Check the sports relay on your computer.' :
            'Connect the sports relay on your computer to load match schedules.') : old ?
              'Some schedules could not refresh. Showing the latest available listings.' : '' };
      });
    sportsPending.catch(function () { sportsPending = null; });
    return sportsPending;
  }
  // How long an event without a listed end stays "Scheduled now": a display policy, not an inferred end time.
  var TYPICAL_HOURS = { Football: 2.5, Rugby: 2.5, Basketball: 3, 'Ice Hockey': 3, 'Australian Football': 3,
    Motorsport: 3, 'American Football': 4, Baseball: 4, Tennis: 5, 'Combat sports': 5, Wrestling: 5, Golf: 7, Cricket: 8 };
  function state(item, now) {
    if (item.kind === 'channel') return 'Always on';
    if (item.startsAt > now) return 'Upcoming';
    if (item.endsAt > 0 && item.endsAt <= now) return 'Ended';
    if (!item.endsAt && now - item.startsAt >= (TYPICAL_HOURS[item.sport] || 4) * 3600000) return 'Status unknown';
    return 'Scheduled now';
  }
  // 45 min, 3 h 10 min, 14 h, 3 days
  function duration(ms) {
    var minutes = Math.max(1, Math.round(ms / 60000)), hours = Math.floor(minutes / 60), rest = minutes % 60;
    if (minutes < 60) return minutes + ' min';
    if (hours < 10 && rest) return hours + ' h ' + rest + ' min';
    return hours < 48 ? hours + ' h' : Math.floor(hours / 24) + ' days';
  }
  // Settings › Sports streams, from the TV service's /sports/health (null off the TV, { down: true } when it doesn't
  // answer). A test result, when there is one, outranks the last real playback.
  function health(h, now) {
    if (!h) return { state: 'unknown', value: 'Not on this TV', text: 'Sports streams are found by the TV service' };
    if (h.down) return { state: 'down', value: 'Not reachable', text: 'The TV service didn’t answer' };
    var r = h.resolver || {}, ok = r.lastOk, error = r.lastError, test = h.test, schedule = h.schedule || {};
    var failing = test ? !test.ok : !!error && (!ok || error.at > ok.at);
    var seconds = function (ms) { return (ms / 1000).toFixed(1) + ' s'; };
    var text;
    if (failing) text = (test ? 'Test failed: ' + test.message : 'Failed ' + duration(now - error.at) + ' ago: ' + error.message).slice(0, 90);
    else if (test) text = 'Found a stream for ' + test.title + ' in ' + seconds(test.ms);
    else if (ok) text = 'Last stream found ' + duration(now - ok.at) + ' ago, in ' + seconds(ok.ms);
    else text = 'Nothing played since the TV started. Press OK to test';
    if (!failing && r.module) text += ' · module ' + r.module.hash;
    if (schedule.status === 'stale') text += ' · schedule from ' + duration(now - schedule.updatedAt) + ' ago';
    else if (schedule.status === 'none') text += ' · no schedule yet';
    return failing ? { state: 'down', value: 'Failing', text: text } :
      ok || test ? { state: 'ok', value: 'Working', text: text } : { state: 'unknown', value: 'Not tested', text: text };
  }
  // "Starts in 3 h 10 min", "Started 40 min ago", or '' for channels and ended events.
  function timing(item, now) {
    if (item.kind !== 'event') return '';
    var status = state(item, now);
    if (status === 'Upcoming') return 'Starts in ' + duration(item.startsAt - now);
    return status === 'Ended' ? '' : 'Started ' + duration(now - item.startsAt) + ' ago';
  }
  function startLabel(item, now) {
    if (!item.startsAt) return '';
    var start = new Date(item.startsAt), today = new Date(now), tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var time = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return (start.toDateString() === today.toDateString() ? 'Today' :
      start.toDateString() === tomorrow.toDateString() ? 'Tomorrow' :
        start.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })) + ', ' + time;
  }
  function badge(item, now) {
    var status = state(item, now);
    if (status === 'Upcoming' && item.startsAt - now < 24 * 3600000) return 'In ' + duration(item.startsAt - now);
    return status;
  }
  // Today lists what can be watched first, then what's coming, then what has finished or gone quiet.
  var RANK = { 'Scheduled now': 0, Upcoming: 1, 'Status unknown': 2, Ended: 3 };
  function select(items, view, sport, preference, now) {
    return items.filter(function (item) {
      if (sport !== 'all' && item.sport !== sport) return false;
      if (view === 'channels') return item.kind === 'channel';
      if (item.kind !== 'event') return false;
      var status = state(item, now);
      if (view === 'now') return status === 'Scheduled now';
      if (view === 'upcoming') return item.startsAt > now;
      return new Date(item.startsAt).toDateString() === new Date(now).toDateString() || status === 'Scheduled now';
    }).map(function (item) {
      return Object.assign({}, item, { streams: preferredStreams(item.streams, preference),
        badge: item.kind === 'event' ? badge(item, now) : '', status: state(item, now),
        meta: item.kind === 'channel' ? item.sport : startLabel(item, now) + ' · ' + item.sport });
    }).filter(function (item) { return item.streams.length > 0; }).sort(function (a, b) {
      if (view === 'channels') return channelRank(a) - channelRank(b) || a.title.localeCompare(b.title);
      return (view === 'today' ? RANK[a.status] - RANK[b.status] : 0) || a.startsAt - b.startsAt ||
        a.title.localeCompare(b.title);
    });
  }
  // The sports catalog's channels (the relay's 24/7 feeds) come before the long public playlists, and its
  // sports channels before its others ("24/7 Streams" of cartoons).
  function channelRank(item) {
    return item.scheduled ? (TYPICAL_HOURS[item.sport] ? 0 : 1) : 2;
  }
  // The sports present in a view, most listed first, so the filter row offers only what is there.
  function sportsIn(items, view, preference, now) {
    var counts = {};
    select(items, view, 'all', preference, now).forEach(function (item) { counts[item.sport] = (counts[item.sport] || 0) + 1; });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
  }
  var api = { parse: parse, merge: merge, channels: channels, groups: groups, sports: sports, relayUrl: relayUrl,
    language: language, languageName: languageName, preferredStreams: preferredStreams,
    readCatalog: readCatalog, health: health, sportOf: sportOf, state: state, timing: timing, startLabel: startLabel, select: select, sportsIn: sportsIn };
  root.Live = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
