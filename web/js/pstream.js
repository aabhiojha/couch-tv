// TMDB catalog and the stream provider adapter for Couch TV.
(function (root) {
  'use strict';
  var override = root.COUCH_SECRETS && root.COUCH_SECRETS.torrentServer;
  var tvIp = '';
  try { tvIp = root.webapis.network.getIp() || ''; } catch (e) { /* desktop or unavailable network */ }
  var TV_SERVICE = !override && !!tvIp;
  var TORRENT_SERVER = override ? override.replace(/\/+$/, '') : 'http://' + (tvIp || '127.0.0.1') + ':11470';
  // Films and episodes come from the stream server set in COUCH_SECRETS.provider (docs/streaming-provider.md);
  // Couch TV ships none.
  var PROVIDER = String(root.COUCH_SECRETS && root.COUCH_SECRETS.provider || '').replace(/\/+$/, '');
  function addonUrls() {
    var urls = root.COUCH_SECRETS && root.COUCH_SECRETS.addons;
    return Array.isArray(urls) ? urls : [];
  }
  var torrentWait = null;
  function heartbeat(timeoutMs) {
    return new Promise(function (resolve) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); resolve(false); }, timeoutMs);
      Promise.resolve().then(function () {
        return fetch(TORRENT_SERVER + '/heartbeat', { signal: controller.signal });
      }).then(function (response) {
        return response.ok ? response.json() : null;
      }).then(function (body) {
        clearTimeout(timer);
        resolve(!!(body && body.success === true));
      }, function () { clearTimeout(timer); resolve(false); });
    });
  }
  function waitForTorrent() {
    if (torrentWait) return torrentWait;
    var deadline = Date.now() + 10000, launched = false;
    function check() {
      return heartbeat(Math.min(1000, deadline - Date.now())).then(function (ok) {
        if (ok) return true;
        if (TV_SERVICE && !launched) {
          launched = true;
          try { root.tizen.application.launch('CouchTor01.Service', function () {}, function () {}); }
          catch (e) { /* service unavailable */ }
        }
        if (Date.now() >= deadline) return false;
        return new Promise(function (resolve) {
          setTimeout(resolve, Math.min(250, deadline - Date.now()));
        }).then(check);
      });
    }
    torrentWait = check().then(function (ok) { torrentWait = null; return ok; });
    return torrentWait;
  }
  function startTorrentService() { if (TV_SERVICE) waitForTorrent(); }
  // Stremio streaming server URLs, verified in docs/torrent-server.md.
  function torrentStats(url) { return url.replace(/(\?|$)/, '/stats.json$1'); }
  // Same file as HLS with the video copied and the audio re-encoded to stereo AAC (for DTS/TrueHD).
  function torrentHls(url) { return url.replace(/(\?|$)/, '/hls.m3u8$1'); }
  function key() { return root.COUCH_SECRETS && root.COUCH_SECRETS.tmdbKey; }
  function request(path, params) {
    if (!key()) return Promise.reject(new Error('TMDB key is missing from js/secrets.js'));
    var url = new URL('https://api.themoviedb.org/3/' + path);
    url.searchParams.set('api_key', key());
    url.searchParams.set('language', 'en-US');
    Object.keys(params || {}).forEach(function (name) { url.searchParams.set(name, params[name]); });
    return fetchWithRetry(url.toString(), 10000).then(function (response) {
      if (!response.ok) throw new Error('TMDB HTTP ' + response.status);
      return response.json();
    });
  }
  // A hung request must never leave a loader up forever: each attempt is aborted after timeoutMs, and a
  // network error, rate limit (429) or server error (5xx) is retried once after a short pause.
  function fetchWithRetry(url, timeoutMs) {
    function attempt() {
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs);
      return fetch(url, controller ? { signal: controller.signal } : undefined).then(function (response) {
        clearTimeout(timer);
        return response;
      }, function (error) {
        clearTimeout(timer);
        throw error;
      });
    }
    function retryable(response) { return response.status === 429 || response.status >= 500; }
    var wait = function () { return new Promise(function (resolve) { setTimeout(resolve, 800); }); };
    return attempt().then(function (response) {
      return retryable(response) ? wait().then(attempt) : response;
    }, function () {
      return wait().then(attempt);
    });
  }
  function item(entry) {
    var kind = entry.media_type || (entry.title ? 'movie' : 'tv');
    if (kind !== 'movie' && kind !== 'tv') return null;
    var id = String(entry.id), title = entry.title || entry.name || 'Untitled';
    var year = (entry.release_date || entry.first_air_date || '').slice(0, 4);
    return { id: 'tmdb:' + kind + ':' + id, tmdbId: id, mediaType: kind,
      title: title, year: year, description: entry.overview || '',
      // Cards are landscape: a backdrop fills them, a portrait poster would be cropped to a strip.
      // w500: sharp at the 480px card size, a third the bytes of w780 on a 1 GB TV.
      thumb: entry.backdrop_path ? 'https://image.tmdb.org/t/p/w500' + entry.backdrop_path
        : entry.poster_path ? 'https://image.tmdb.org/t/p/w342' + entry.poster_path : '',
      backdrop: entry.backdrop_path ? 'https://image.tmdb.org/t/p/w1280' + entry.backdrop_path : '',
      rating: entry.vote_average || 0, isSeries: kind === 'tv', kind: kind === 'tv' ? 'series' : 'film',
      originalLanguage: entry.original_language || '',
      source: 'pstream' };
  }
  function items(data) { return (data.results || []).map(item).filter(Boolean); }
  // The best YouTube trailer TMDB lists: trailers before teasers, official ones first, English before others.
  function trailer(videos) {
    var list = ((videos && videos.results) || []).filter(function (v) {
      return v.site === 'YouTube' && /^[\w-]{11}$/.test(v.key) && (v.type === 'Trailer' || v.type === 'Teaser');
    });
    list.sort(function (a, b) {
      return (b.type === 'Trailer') - (a.type === 'Trailer') || (b.official === true) - (a.official === true) ||
        (a.iso_639_1 === 'en' ? 0 : 1) - (b.iso_639_1 === 'en' ? 0 : 1);
    });
    return list.length ? list[0].key : '';
  }
  // Age rating for the household's country (India), else the US one: "U/A 13+", "PG-13", "TV-MA".
  function certification(data, kind) {
    var by = {};
    if (kind === 'movie') ((data.release_dates && data.release_dates.results) || []).forEach(function (r) {
      var rated = (r.release_dates || []).filter(function (d) { return d.certification; })[0];
      if (rated) by[r.iso_3166_1] = rated.certification;
    });
    else ((data.content_ratings && data.content_ratings.results) || []).forEach(function (r) { if (r.rating) by[r.iso_3166_1] = r.rating; });
    return by.IN || by.US || '';
  }
  function people(credits) {
    return ((credits && credits.cast) || []).slice(0, 15).map(function (c) {
      var initials = (c.name || '').split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 2);
      return { id: 'person:' + c.id, personId: String(c.id), title: c.name || '', meta: c.character || '', kind: 'person', fallback: initials,
        thumb: c.profile_path ? 'https://image.tmdb.org/t/p/w185' + c.profile_path : '' };
    }).filter(function (p) { return p.title; });
  }
  // TMDB serves at most 500 pages of 20.
  function list(path, params, page) {
    return request(path, Object.assign({ page: page || 1 }, params)).then(function (d) {
      return { items: items(d), total: Math.min(d.total_results || 0, 10000) };
    });
  }
  function duration(minutes) {
    var hours = Math.floor(minutes / 60), rest = minutes % 60;
    return [hours ? hours + 'h' : '', rest ? rest + 'm' : ''].filter(Boolean).join(' ');
  }
  function detail(id) {
    var parts = id.split(':');
    if (parts.length !== 3 || parts[0] !== 'tmdb' || !/^\d+$/.test(parts[2]))
      return Promise.reject(new Error('Invalid TMDB ID'));
    var kind = parts[1], number = parts[2];
    if (kind !== 'movie' && kind !== 'tv') return Promise.reject(new Error('Invalid media type'));
    // Series: up to 19 seasons ride along with the show request (append_to_response), so a long
    // show needs one or two requests instead of one per season. A failed batch is skipped.
    // TMDB appends at most 20 parts: a show's first 16 seasons ride with its trailer, cast and age rating.
    var batch = [];
    for (var n = 1; n <= 16; n++) batch.push('season/' + n);
    var extras = kind === 'tv' ? ['external_ids', 'videos', 'credits', 'content_ratings'] : ['videos', 'credits', 'release_dates'];
    return request(kind + '/' + number, { append_to_response: (kind === 'tv' ? batch : []).concat(extras).join(','),
      include_video_language: 'en,hi,null' }).then(function (data) {
      var result = item(Object.assign({ media_type: kind }, data));
      result.trailer = trailer(data.videos);
      result.cast = people(data.credits);
      result.director = ((data.credits && data.credits.crew) || []).filter(function (c) { return c.job === 'Director'; })
        .slice(0, 2).map(function (c) { return c.name; }).join(', ');
      result.certification = certification(data, kind);
      result.imdbId = (kind === 'movie' ? data.imdb_id : data.external_ids && data.external_ids.imdb_id) || '';
      result.subjects = (data.genres || []).slice(0, 6).map(function (g) { return g.name; });
      result.creator = (data.created_by || []).map(function (p) { return p.name; }).join(', ');
      var seasonCount = data.number_of_seasons || 0;
      result.runtime = kind === 'tv' ? (seasonCount ? seasonCount + (seasonCount === 1 ? ' season' : ' seasons') : '')
        : duration(data.runtime || 0);
      if (kind === 'movie') {
        result.videos = [{ url: 'pstream:movie:' + number, title: result.title, durationSec: (data.runtime || 0) * 60 }];
        return result;
      }
      var seasons = (data.seasons || []).filter(function (s) { return s.season_number > 0 && s.episode_count > 0; });
      var missing = seasons.filter(function (s) { return !data['season/' + s.season_number]; });
      var chunks = [];
      for (var i = 0; i < missing.length; i += 19) chunks.push(missing.slice(i, i + 19));
      return Promise.all(chunks.map(function (chunk) {
        return request(kind + '/' + number, { append_to_response: chunk.map(function (s) { return 'season/' + s.season_number; }).concat('external_ids').join(',') })
          .catch(function () { return {}; });
      })).then(function (extras) {
        extras.forEach(function (extra) {
          Object.keys(extra).forEach(function (k) { if (k.indexOf('season/') === 0) data[k] = extra[k]; });
        });
        var videos = [], today = new Date(Date.now()).toISOString().slice(0, 10);
        seasons.forEach(function (season) {
          var body = data['season/' + season.season_number];
          ((body && body.episodes) || []).forEach(function (episode) {
            // Announced episodes have no stream yet; listing them made Play and autoplay-next fail.
            if (episode.air_date && episode.air_date > today) return;
            videos.push({ url: 'pstream:show:' + number + ':' + season.season_number + ':' + episode.episode_number,
              title: episode.name || 'Episode ' + episode.episode_number, season: season.season_number,
              seasonId: String(season.id), episode: episode.episode_number, episodeId: String(episode.id),
              durationSec: (episode.runtime || 0) * 60, description: episode.overview || '',
              still: episode.still_path ? 'https://image.tmdb.org/t/p/w300' + episode.still_path : '' });
          });
        });
        videos.sort(function (a, b) { return a.season - b.season || a.episode - b.episode; });
        result.videos = videos;
        return result;
      });
    });
  }
  // exclude: source URLs already tried (after a playback failure); the result says how many remain.
  function providerCandidates(item, video, quality, exclude) {
    var path = item.mediaType === 'tv'
      ? '/v1/tv/' + encodeURIComponent(item.tmdbId) + '/seasons/' + encodeURIComponent(video.season) + '/episodes/' + encodeURIComponent(video.episode)
      : '/v1/movies/' + encodeURIComponent(item.tmdbId);
    if (!PROVIDER) return Promise.resolve([]);
    return fetch(PROVIDER + path).catch(function () {
      throw new Error("Can't reach the stream server");
    }).then(function (response) {
      if (!response.ok) throw new Error('Provider HTTP ' + response.status);
      return response.json();
    }).then(function (body) {
      var sources = (body.sources || []).filter(function (source) {
        return (source.type === 'hls' || source.type === 'mp4') &&
          source.url && source.url.indexOf(PROVIDER + '/v1/proxy?') === 0;
      }).map(function (source) {
        return { url: source.url.replace('/v1/proxy?', '/v1/proxy.m3u8?') };
      }).filter(function (source) {
        return (exclude || []).indexOf(source.url) < 0;
      });
      if (!sources.length) throw new Error(exclude && exclude.length ? 'No other stream worked for this title' : 'No stream found for this title');
      return Promise.all(sources.map(function (source) {
        return qualities(source.url).catch(function () { return []; });
      })).then(function (lists) {
        var all = [];
        lists.forEach(function (list) { list.forEach(function (h) { if (all.indexOf(h) < 0) all.push(h); }); });
        all.sort(function (a, b) { return b - a; });
        var want = quality === 'best' || !quality ? all[0] || 0 : Number(quality);
        // The first (preferred) source that has the wanted class, else the one closest below it.
        return sources.map(function (source, index) {
          return { url: source.url + (quality && quality !== 'best' ? '&quality=' + quality : ''),
            headers: {}, qualities: all, source: source.url, kind: 'provider', stats: '',
            top: lists[index].filter(function (h) { return h <= want; })[0] || 0 };
        }).sort(function (a, b) { return b.top - a.top; });
      });
    });
  }
  // mode: 'torrent' or 'web' (asked before playing) puts that family first; without it Settings › Source order
  // decides. Either way the other family is the fallback when the first has nothing that plays.
  function scrape(item, video, quality, exclude, onStatus, mode) {
    if (!PROVIDER && !addonUrls().length) return Promise.reject(new Error('No sources set up: add a stream server or add-ons to js/secrets.js'));
    var providerError;
    var provider = providerCandidates(item, video, quality, exclude).catch(function (error) {
      providerError = error;
      return [];
    });
    var addons = Promise.resolve([]);
    if (root.Addons && item.imdbId) {
      addons = Promise.resolve().then(function () {
        var series = item.mediaType === 'tv';
        return root.Addons.streams(addonUrls(),
          series ? 'series' : 'movie', item.imdbId + (series ? ':' + video.season + ':' + video.episode : ''));
      }).then(function (streams) {
        return root.Addons.rank(streams.filter(function (s) { return s.playable && !(TV_SERVICE && s.needsTranscode); }), quality || 'best').slice(0, 5).map(function (s) {
          var file = s.kind === 'torrent' ? root.Addons.torrentUrl(TORRENT_SERVER, s) : s.url;
          var url = s.kind === 'torrent' && s.needsTranscode ? torrentHls(file) : file;
          return { url: url, headers: {}, qualities: s.quality ? [s.quality] : [], source: url,
            kind: s.kind, stats: s.kind === 'torrent' ? torrentStats(file) : '' };
        });
      }).catch(function () { return []; });
    }
    function untried(list) {
      return list.filter(function (s, index, all) {
        return (exclude || []).indexOf(s.source) < 0 && all.findIndex(function (other) { return other.source === s.source; }) === index;
      });
    }
    function choose(candidates, more) {
      var chosen = candidates[0];
      delete chosen.top;
      chosen.remaining = candidates.length - 1 + more;
      return chosen;
    }
    var providerFirst = mode ? mode === 'web' : root.Data && root.Data.settings().sourceOrder === 'provider-first';
    var first = providerFirst ? provider : addons, second = providerFirst ? addons : provider;
    // The preferred family plays as soon as it has a candidate: the other one can take 15 s to fail
    // (a stream server with no sources). It still counts as one fallback, looked up again on the next attempt.
    return first.then(function (preferred) {
      var ready = untried(preferred);
      if (ready.length) return choose(ready, 1);
      if (mode && onStatus) onStatus(mode === 'web' ? 'No web stream found. Trying torrents…' : 'No torrent found. Trying web streams…');
      return second.then(function (rest) {
        var candidates = untried(preferred.concat(rest));
        if (!candidates.length) throw providerError || new Error(exclude && exclude.length
          ? 'No other stream worked for this title' : 'No stream found for this title');
        return choose(candidates, 0);
      });
    }).then(function (chosen) {
      if (chosen.kind !== 'torrent') return chosen;
      if (onStatus) onStatus('Starting torrent engine…');
      return waitForTorrent().then(function (ok) {
        if (onStatus) onStatus('');
        if (ok) return chosen;
        // All torrents use this engine; try the remaining HTTP/provider sources if it is down.
        return addons.then(function (streams) {
          var rest = untried(streams).filter(function (s) { return s.kind !== 'torrent'; });
          if (rest.length) return choose(rest, 1);
          return provider.then(function (streams) {
            var rest = untried(streams);
            if (!rest.length) throw new Error('Torrent engine is not reachable');
            return choose(rest, 0);
          });
        });
      });
    });
  }
  // Title logo (English, else the original language) and the best-rated backdrop without text, so a
  // logo can sit on the artwork without doubling the title. Paths only; callers pick image sizes.
  function images(entry) {
    var lang = entry.originalLanguage && entry.originalLanguage !== 'en' ? entry.originalLanguage : '';
    return request(entry.mediaType + '/' + entry.tmdbId + '/images',
      { include_image_language: 'en,' + (lang ? lang + ',' : '') + 'null' }).then(function (d) {
      function best(list, language) {
        return list.filter(function (i) { return i.iso_639_1 === language; })
          .sort(function (a, b) { return b.vote_average - a.vote_average; })[0];
      }
      var logo = best(d.logos || [], 'en') || (lang && best(d.logos || [], lang));
      var backdrop = best(d.backdrops || [], null);
      return { logo: logo ? logo.file_path : '', backdrop: backdrop ? backdrop.file_path : '' };
    });
  }
  // Renditions a stream offers, as standard heights. Classed by frame width so a 1920x800 scope film
  // counts as 1080p; the relay uses the same classes when ?quality= picks one.
  function qualityClass(width) {
    return width >= 3800 ? 2160 : width >= 1900 ? 1080 : width >= 1260 ? 720 : width >= 840 ? 480 : 360;
  }
  function qualities(url) {
    return fetch(url + '&quality=all').then(function (response) {
      if (!response.ok) throw new Error('Provider HTTP ' + response.status);
      return response.text();
    }).then(function (text) {
      var heights = [];
      text.replace(/RESOLUTION=(\d+)x\d+/g, function (match, width) {
        var height = qualityClass(Number(width));
        if (heights.indexOf(height) < 0) heights.push(height);
        return match;
      });
      return heights.sort(function (a, b) { return b - a; });
    });
  }
  // Reachability of the provider server for Settings: resolves { ok, ms }, never rejects. The TV's own service is
  // started if it isn't running (the TV can stop it in standby or when memory runs low).
  function ping(torrent) {
    if (!torrent && !PROVIDER) return Promise.resolve({ ok: false, ms: 0, host: 'Not set up' });
    var base = torrent ? TORRENT_SERVER : PROVIDER, onTv = torrent && TV_SERVICE;
    var started = Date.now();
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(false); }, onTv ? 11000 : 4000); });
    var check = (onTv ? waitForTorrent() : Promise.resolve(true)).then(function () {
      return torrent ? heartbeat(4000) : fetch(base + '/').then(function (r) { return r.ok; }, function () { return false; });
    });
    return Promise.race([check, timeout]).then(function (ok) { return { ok: ok, ms: Date.now() - started, host: onTv ? 'On this TV' : base.replace(/^https?:\/\//, '') }; });
  }
  var api = {
    list: list,
    search: function (query, page) { return list('search/multi', { query: query }, page); },
    related: function (entry) { return request(entry.mediaType + '/' + entry.tmdbId + '/recommendations').then(items); },
    // A series' latest aired episode, for Home's New Episodes: { season, episode, airDate } or null.
    lastAired: function (tmdbId) {
      return request('tv/' + tmdbId).then(function (d) {
        var last = d.last_episode_to_air;
        return last && last.air_date ? { season: last.season_number, episode: last.episode_number, airDate: last.air_date } : null;
      });
    },
    // A person's films and shows, most popular first (each title once).
    personCredits: function (personId) {
      return request('person/' + personId + '/combined_credits').then(function (d) {
        var seen = {};
        return items({ results: (d.cast || []).slice().sort(function (a, b) { return (b.popularity || 0) - (a.popularity || 0); })
          .filter(function (c) { var key = c.media_type + c.id; if (seen[key] || c.media_type === 'tv' && c.character === 'Self') return false; seen[key] = true; return true; }) });
      });
    },
    detail: detail, scrape: scrape, images: images, ping: ping, startTorrentService: startTorrentService, waitForTorrent: waitForTorrent,
    // The TV's own service (torrents and the trailer page), or '' off the TV.
    tvService: function () { return TV_SERVICE ? TORRENT_SERVER : ''; }
  };
  root.PStream = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
