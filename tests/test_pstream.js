const assert = require('node:assert/strict');
global.COUCH_SECRETS = { tmdbKey: 'test-key', torrentServer: 'http://192.168.1.34:11470',
  provider: 'http://192.168.1.34:8788/', addons: ['https://addon.example'] };
const calls = [];
let scrapeBody = { sources: [{ type: 'hls', url: 'http://192.168.1.34:8788/v1/proxy?data=movie', provider: { id: 'one' } }] };
let failOnce = null; // path whose next request fails with a network error
global.fetch = async function (url) {
  const address = new URL(url);
  calls.push(address);
  if (failOnce && address.pathname.endsWith(failOnce)) { failOnce = null; throw new TypeError('Failed to fetch'); }
  if (address.pathname === '/heartbeat') return { ok: true, json: async () => ({ success: true }) };
  if (address.pathname.endsWith('/search/multi')) return { ok: true, json: async () => ({ total_results: 1, results: [
    { id: 27205, media_type: 'movie', title: 'Inception', release_date: '2010-07-16' },
    { id: 1, media_type: 'person', name: 'Someone' }
  ] }) };
  if (address.pathname.endsWith('/tv/1398')) {
    const body = { id: 1398, name: 'Long show', external_ids: { imdb_id: 'tt1234567' },
      seasons: Array.from({ length: 40 }, (_, i) => ({ season_number: i + 1, episode_count: 1 })) };
    address.searchParams.get('append_to_response').split(',').filter(s => s.startsWith('season/')).forEach(s => {
      body[s] = { episodes: [{ episode_number: 1, name: s }] };
    });
    return { ok: true, json: async () => body };
  }
  // Seasons 1-19 arrive with the show; later ones in follow-up batches. Show 1397's follow-up fails.
  const show = address.pathname.match(/\/tv\/(1396|1397)$/);
  if (show) {
    const append = address.searchParams.get('append_to_response') || '';
    const late = show[1] === '1396' ? 22 : 41;
    if (append.startsWith('season/' + late)) {
      if (late === 41) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({ ['season/' + late]: { episodes: [{ id: 21, episode_number: 1, name: 'Later' }] } }) };
    }
    return { ok: true, json: async () => ({ id: +show[1], external_ids: { imdb_id: 'tt0903747' }, name: 'Breaking Bad', first_air_date: '2008-01-20', number_of_seasons: 2,
      seasons: [{ id: 10, season_number: 1, episode_count: 1 }, { id: 11, season_number: late, episode_count: 1 }],
      'season/1': append.includes('season/1,') ? { episodes: [{ id: 20, episode_number: 1, name: 'Pilot', runtime: 47, overview: 'Walt.' },
        { id: 22, episode_number: 2, name: 'Announced', air_date: '2999-01-01' }] } : undefined }) };
  }
  if (address.pathname.endsWith('/movie/27205/images')) return { ok: true, json: async () => ({
    logos: [{ iso_639_1: 'hi', file_path: '/hi.png', vote_average: 9 }, { iso_639_1: 'en', file_path: '/en-low.png', vote_average: 2 },
      { iso_639_1: 'en', file_path: '/en.png', vote_average: 5 }],
    backdrops: [{ iso_639_1: 'en', file_path: '/text.jpg', vote_average: 9 }, { iso_639_1: null, file_path: '/clean.jpg', vote_average: 4 }] }) };
  if (address.pathname.endsWith('/movie/360814/images')) return { ok: true, json: async () => ({
    logos: [{ iso_639_1: 'hi', file_path: '/dangal-hi.png', vote_average: 1 }], backdrops: [] }) };
  if (address.pathname.endsWith('/movie/27205')) return { ok: true, json: async () => ({ id: 27205, imdb_id: 'tt1375666', title: 'Inception', release_date: '2010-07-16' }) };
  if (address.pathname === '/v1/proxy.m3u8') {
    const resolution = { broken: '1920x800', working: '1280x720', movie: '1280x720', hd: '1920x800', sd: '1280x720' }[address.searchParams.get('data')];
    return resolution ? { ok: true, text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=854x480\nlow\n#EXT-X-STREAM-INF:BANDWIDTH=2,RESOLUTION=' + resolution + '\nhigh' }
      : { ok: false, status: 404 };
  }
  if (address.pathname.startsWith('/v1/')) return { ok: true, json: async () => scrapeBody };
  throw Error('Unexpected URL: ' + url);
};
const PStream = require('../web/js/pstream.js');
(async () => {
  failOnce = '/search/multi';                                    // retried once after a network error
  const search = await PStream.search('Inception', 1);
  assert.equal(search.items.length, 1);
  assert.equal(search.items[0].id, 'tmdb:movie:27205');
  const show = await PStream.detail('tmdb:tv:1396');
  assert.equal(show.videos[0].episodeId, '20');
  assert.deepEqual(show.videos.map(v => v.season), [1, 22]);
  assert.equal(show.imdbId, 'tt0903747');
  const firstBatch = calls.find(c => c.pathname.endsWith('/tv/1396')).searchParams.get('append_to_response').split(',');
  assert.equal(firstBatch.length, 20);
  assert(firstBatch.includes('external_ids'));
  assert(firstBatch.includes('season/16'));                      // 16 seasons ride with trailer, cast and rating
  assert(!firstBatch.includes('season/17'));
  assert(['videos', 'credits', 'content_ratings'].every(part => firstBatch.includes(part)));
  assert.equal(show.runtime, '2 seasons');
  assert.equal(show.videos[0].durationSec, 47 * 60);             // episode runtime and synopsis kept
  assert.equal(show.videos[0].description, 'Walt.');
  assert(!show.videos.some(v => v.title === 'Announced'));      // unaired episodes are not listed
  assert.deepEqual((await PStream.detail('tmdb:tv:1397')).videos.map(v => v.season), [1]); // failed batch skipped
  const longShow = await PStream.detail('tmdb:tv:1398');
  assert.equal(longShow.imdbId, 'tt1234567');
  assert.equal(longShow.videos.length, 40);
  const batches = calls.filter(c => c.pathname.endsWith('/tv/1398')).map(c => c.searchParams.get('append_to_response').split(','));
  assert.deepEqual(batches.map(b => b.length), [20, 20, 6]);           // 16 seasons first, then 19 a request
  assert(batches.every(b => b.includes('external_ids')));
  const movie = await PStream.detail('tmdb:movie:27205');
  assert.equal(movie.imdbId, 'tt1375666');
  assert(calls.filter(c => c.pathname.includes('/tv/')).every(c => c.searchParams.get('append_to_response').split(',').length <= 20));
  assert.equal(movie.videos[0].url, 'pstream:movie:27205');
  // Logos: English first, else the original language; backdrops: the best one without text.
  assert.deepEqual(await PStream.images({ mediaType: 'movie', tmdbId: '27205', originalLanguage: 'en' }), { logo: '/en.png', backdrop: '/clean.jpg' });
  assert.equal(calls.at(-1).searchParams.get('include_image_language'), 'en,null');
  assert.deepEqual(await PStream.images({ mediaType: 'movie', tmdbId: '360814', originalLanguage: 'hi' }), { logo: '/dangal-hi.png', backdrop: '' });
  assert.equal(calls.at(-1).searchParams.get('include_image_language'), 'en,hi,null');
  const stream = await PStream.scrape(show, show.videos[0]);
  assert.equal(stream.url, 'http://192.168.1.34:8788/v1/proxy.m3u8?data=movie');
  assert(calls.some(c => c.pathname === '/v1/tv/1396/seasons/1/episodes/1'));
  scrapeBody = { sources: [
    { type: 'hls', url: 'http://192.168.1.34:8788/v1/proxy?data=working', provider: { id: 'one' } },
    { type: 'hls', url: 'http://192.168.1.34:8788/v1/proxy?data=broken', provider: { id: 'two' } }
  ] };
  // Best: the source with the highest rendition (1080p beats 720p); every quality is listed.
  let best = await PStream.scrape(movie, movie.videos[0], 'best');
  assert.equal(best.url, 'http://192.168.1.34:8788/v1/proxy.m3u8?data=broken');
  assert.deepEqual(best.qualities, [1080, 720, 480]);
  // A chosen quality keeps the stream server's order among sources that have it, and asks the relay for it.
  assert.equal((await PStream.scrape(movie, movie.videos[0], 720)).url, 'http://192.168.1.34:8788/v1/proxy.m3u8?data=working&quality=720');
  assert.equal((await PStream.scrape(movie, movie.videos[0], 1080)).url, 'http://192.168.1.34:8788/v1/proxy.m3u8?data=broken&quality=1080');
  // After a failure the tried source is excluded; when none are left the error says so.
  const fallback = await PStream.scrape(movie, movie.videos[0], 'best', ['http://192.168.1.34:8788/v1/proxy.m3u8?data=broken']);
  assert.equal(fallback.url, 'http://192.168.1.34:8788/v1/proxy.m3u8?data=working');
  assert.equal(fallback.remaining, 0);
  assert.equal(best.remaining, 1);
  await assert.rejects(PStream.scrape(movie, movie.videos[0], 'best', [best.source, fallback.source]), /No other stream worked/);
  // A source whose playlist can't be read is still usable.
  scrapeBody = { sources: [{ type: 'hls', url: 'http://192.168.1.34:8788/v1/proxy?data=unknown', provider: { id: 'one' } }] };
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best')).url, 'http://192.168.1.34:8788/v1/proxy.m3u8?data=unknown');
  scrapeBody = { sources: [] };
  await assert.rejects(PStream.scrape(movie, movie.videos[0]), /No stream found/);
  scrapeBody = { sources: [{ type: 'hls', url: 'https://example.com/play.m3u8', provider: { id: 'one' } }] };
  await assert.rejects(PStream.scrape(movie, movie.videos[0]), /No stream found/);
  scrapeBody = { sources: [
    { type: 'hls', url: 'http://192.168.1.34:8788/v1/proxy?data=hd', provider: { id: 'one' } },
    { type: 'hls', url: 'http://192.168.1.34:8788/v1/proxy?data=sd' }
  ] };
  let order = 'addons-first', addonCalls = [], failAddon = false;
  global.Data = { settings: () => ({ sourceOrder: order }) };
  const torrent = { kind: 'torrent', infoHash: 'abc', fileIdx: 2, quality: 1080, playable: true, needsTranscode: true };
  const http = { kind: 'http', url: 'https://example.com/movie.mp4', quality: 720, playable: true };
  let addonStreams = [torrent, http, { kind: 'http', url: 'bad', playable: false }];
  global.Addons = {
    streams: async (urls, type, id) => {
      addonCalls.push({ urls, type, id });
      if (failAddon) throw Error('addon unavailable');
      return addonStreams;
    },
    rank: (streams, quality) => { assert(streams.every(s => s.playable)); assert.equal(quality, 'best'); return streams; },
    torrentUrl: (base, stream) => base + '/' + stream.infoHash + '/' + stream.fileIdx
  };
  const first = await PStream.scrape(movie, movie.videos[0], 'best');
  assert.equal(first.kind, 'torrent');
  assert.equal(first.url, 'http://192.168.1.34:11470/abc/2/hls.m3u8');  // DTS/TrueHD: audio re-encoded via HLS
  assert.equal(first.source, first.url);
  assert.equal(first.stats, 'http://192.168.1.34:11470/abc/2/stats.json');
  assert.deepEqual(first.qualities, [1080]);
  assert.equal(first.remaining, 2);          // the other add-on stream + the provider family (not awaited)
  assert.deepEqual(addonCalls[0], { urls: ['https://addon.example'], type: 'movie', id: 'tt1375666' });
  global.COUCH_SECRETS.addons = ['https://test.example/manifest.json'];
  await PStream.scrape(show, show.videos[0], 'best');
  assert.deepEqual(addonCalls.at(-1), { urls: global.COUCH_SECRETS.addons, type: 'series', id: 'tt0903747:1:1' });
  const second = await PStream.scrape(movie, movie.videos[0], 'best', [first.source]);
  assert.equal(second.kind, 'http');
  assert.equal(second.remaining, 1);
  assert.equal(second.stats, '');
  const third = await PStream.scrape(movie, movie.videos[0], 'best', [first.source, second.source]);
  assert.equal(third.kind, 'provider');
  assert.equal(third.remaining, 1);
  const fourth = await PStream.scrape(movie, movie.videos[0], 'best', [first.source, second.source, third.source]);
  assert.equal(fourth.remaining, 0);
  await assert.rejects(PStream.scrape(movie, movie.videos[0], 'best', [first.source, second.source, third.source, fourth.source]), /No other stream worked/);
  order = 'provider-first';
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best')).source, third.source);
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best', [third.source, fourth.source])).source, first.source);
  // The answer to "Torrent or web stream?" overrides Source order, and the other family stays the fallback.
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best', [], null, 'torrent')).kind, 'torrent');
  order = 'addons-first';
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best', [], null, 'web')).source, third.source);
  const statuses = [];
  const onlyTorrents = await PStream.scrape(movie, movie.videos[0], 'best', [third.source, fourth.source], t => statuses.push(t), 'web');
  assert.equal(onlyTorrents.kind, 'torrent');
  assert.equal(statuses[0], 'No web stream found. Trying torrents…');
  order = 'provider-first';
  failAddon = true;
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best')).kind, 'provider');
  failAddon = false;
  const before = addonCalls.length;
  assert.equal((await PStream.scrape(Object.assign({}, movie, { imdbId: '' }), movie.videos[0], 'best')).kind, 'provider');
  assert.equal(addonCalls.length, before);
  scrapeBody = { sources: [] };
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best')).kind, 'torrent');
  addonStreams = Array.from({ length: 7 }, (_, i) => Object.assign({}, http, { url: http.url + i }));
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best')).remaining, 4);  // provider-first, provider empty: all five counted
  const originalFetch = global.fetch;
  global.fetch = async url => new URL(url).pathname.startsWith('/v1/movies/')
    ? { ok: false, status: 403 } : originalFetch(url);
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best')).kind, 'http');
  global.fetch = originalFetch;
  let providerStarted = false, releaseProvider;
  global.fetch = async url => {
    if (new URL(url).pathname.startsWith('/v1/movies/')) {
      providerStarted = true;
      await new Promise(resolve => { releaseProvider = resolve; });
    }
    return originalFetch(url);
  };
  global.Addons.streams = async () => { assert(providerStarted); return addonStreams; };
  // Add-ons first: a provider that hasn't answered yet doesn't hold up an add-on stream.
  assert.equal((await PStream.scrape(movie, movie.videos[0], 'best')).kind, 'http');
  releaseProvider();
  global.fetch = async url => ({ ok: new URL(url).port === '11470', json: async () => ({ success: true }) });
  assert.equal((await PStream.ping(true)).ok, true);
  assert.equal((await PStream.ping()).ok, false);
  global.fetch = originalFetch;
  delete global.Addons;
  delete global.Data;

})().catch(error => { console.error(error); process.exitCode = 1; });

// Exercise the real player with a small DOM and clock; no TV backend tuning is mocked into it.
async function checkPlayerStatus() {
  const fs = require('node:fs'), vm = require('node:vm');
  let now = 0, intervals = new Map(), nodes = [];
  function node(tag) {
    const n = { tag, children: [], style: {}, events: {}, currentTime: 0, duration: 100,
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      insertBefore() {}, removeChild() {}, setAttribute() {}, removeAttribute() {},
      addEventListener(event, fn) { this.events[event] = fn; },
      pause() {}, play() { return Promise.resolve(); }, load() {},
      get lastChild() { return this.children.at(-1); } };
    nodes.push(n);
    return n;
  }
  const root = node('div');
  const document = { getElementById: () => root, createElement: node, createElementNS: (_, tag) => node(tag),
    addEventListener() {}, removeEventListener() {}, hidden: false };
  const window = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/js/player.js'), 'utf8'), {
    window, document, Date: class extends Date { static now() { return now; } },
    setInterval: (fn, ms) => { const id = {}; intervals.set(id, { fn, ms }); return id; },
    clearInterval: id => intervals.delete(id), setTimeout: () => 1, clearTimeout() {}
  });
  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  async function tick(seconds) {
    for (let i = 0; i < seconds; i++) {
      now += 1000;
      for (const task of Array.from(intervals.values())) if (task.ms === 1000) task.fn();
      await flush();
    }
  }
  let failures = 0, polls = 0, resolveStream;
  window.Player.open({ stream: new Promise(resolve => { resolveStream = resolve; }),
    status: () => { polls++; return 'Torrent · 23 peers · 41 %'; },
    onFailure: () => { failures++; return true; } });
  await tick(1);
  assert.equal(polls, 1);
  assert(nodes.some(n => n.textContent === 'Torrent · 23 peers · 41 %'));
  resolveStream({ url: 'http://test/torrent', kind: 'torrent' });
  await flush();
  await tick(44);
  assert.equal(failures, 0);
  await tick(1);
  assert.equal(failures, 1);
  assert.equal(window.Player.isOpen(), false);
  assert.equal(intervals.size, 0);
  window.Player.open({ stream: Promise.resolve({ url: 'http://test/torrent', kind: 'torrent' }),
    status: () => Promise.reject(Error('stats down')), onFailure: () => { failures++; return true; } });
  await flush();
  const video = nodes.filter(n => n.tag === 'video').at(-1);
  await tick(40);
  video.currentTime = 10;
  video.events.timeupdate();
  await tick(40);
  assert.equal(failures, 1); // advancing playback resets the deadline even when stats fail
  window.Player.handleKey(19);
  await tick(60);
  assert.equal(failures, 1); // paused torrents do not fail
  window.Player.close();
  window.Player.open({ stream: Promise.resolve({ url: 'http://test/provider', kind: 'provider' }),
    onFailure: () => { failures++; return true; } });
  await flush();
  await tick(60);
  assert.equal(failures, 1); // the new deadline is torrent-only
  window.Player.close();
  let percent = 0;
  window.Player.open({ stream: Promise.resolve({ url: 'http://test/torrent', kind: 'torrent' }),
    status: () => 'Torrent · ' + (percent++) + ' %', onFailure: () => { failures++; return true; } });
  await flush();
  nodes.filter(n => n.tag === 'video').at(-1).events.waiting();
  await tick(90);
  assert.equal(failures, 1); // a buffering torrent whose download moves is not stalled
  window.Player.close();
  window.Player.open({ stream: Promise.resolve({ url: 'http://test/torrent', kind: 'torrent' }),
    next: { title: 'Show', subtitle: 'S1 · E2' }, autoplayNext: false, onFailure: () => { failures++; return true; } });
  await flush();
  nodes.filter(n => n.tag === 'video').at(-1).events.ended();
  await tick(60);
  assert.equal(failures, 1); // an ended episode waiting on "Play next" is not stalled
  window.Player.close();
}
checkPlayerStatus().catch(error => { console.error(error); process.exitCode = 1; });

// Subtitle tracks inside the stream: listed in the Subtitles panel, English chosen when Settings has
// subtitles on, and AVPlay's caption text shown without its markup.
async function checkEmbeddedSubtitles() {
  const fs = require('node:fs'), vm = require('node:vm');
  const nodes = [];
  function node(tag) {
    const n = { tag, children: [], style: {}, events: {},
      appendChild(child) { this.children.push(child); child.parentNode = this; },
      insertBefore() {}, removeChild() {}, setAttribute() {}, removeAttribute() {}, addEventListener() {},
      get lastChild() { return this.children.at(-1); } };
    nodes.push(n);
    return n;
  }
  const root = node('div');
  let listener;
  const chosen = [];
  const avplay = { open() {}, setListener(l) { listener = l; }, setDisplayRect() {}, setDisplayMethod() {}, setBufferingParam() {},
    prepareAsync(ready) { ready(); }, getDuration: () => 600000, getState: () => 'PLAYING', getCurrentTime: () => 0,
    play() {}, pause() {}, stop() {}, close() {},
    getTotalTrackInfo: () => [{ index: 0, type: 'VIDEO', extra_info: '{}' },
      { index: 3, type: 'TEXT', extra_info: '{"track_lang":"hin"}' }, { index: 4, type: 'TEXT', extra_info: '{"track_lang":"eng"}' }],
    setSelectTrack: (type, index) => chosen.push(type + ' ' + index), setSilentSubtitle: silent => chosen.push('silent ' + silent) };
  const window = { webapis: { avplay } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/js/player.js'), 'utf8'), {
    window, document: { getElementById: () => root, createElement: node, createElementNS: (_, tag) => node(tag),
      addEventListener() {}, removeEventListener() {}, hidden: false },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  window.Player.open({ url: 'http://test/film.mkv', subtitlesOn: true });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(chosen, ['TEXT 4', 'silent false']); // English over Hindi
  const rows = nodes.filter(n => n.className === 'player-row-text').map(n => n.textContent);
  assert.deepEqual(rows.slice(-6), ['Off', 'Hindi', 'English', 'Small', 'Medium', 'Large']);
  listener.onsubtitlechange(2000, '{\\an8}<i>Hello</i>\\Nthere\u0000');
  assert(nodes.some(n => String(n.className).indexOf('player-caption ') === 0 && n.textContent === 'Hello\nthere'));
  window.Player.close();
}
checkEmbeddedSubtitles().catch(error => { console.error(error); process.exitCode = 1; });

async function checkPlaybackWiring() {
  const vm = require('node:vm'), fs = require('node:fs');
  let opts, statsUrl, history, finishStream, started = false, beacon, went, asked, scrapedMode, saved = {};
  const film = { id: 'tmdb:movie:1', title: 'Film', thumb: 'http://test/film.jpg', isSeries: false };
  const Data = { settings: () => ({}), setSetting: (key, value) => { saved[key] = value; }, nextVideo: () => null, resumeFrom: () => 100,
    onChange() {}, setProgress: (...args) => { history = args; },
    continueWatching: () => [{ item: film, video: {}, positionSec: 60, durationSec: 600 }],
    sportsBookmarks: () => [{ id: 'streamed:willow', title: 'Willow', kind: 'channel', sport: 'Cricket', startsAt: 0, thumb: '' }] };
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/js/main.js'), 'utf8'), {
    Data, window: { addEventListener() {} },
    document: { documentElement: { classList: { toggle() {} } }, getElementById() {}, querySelector() { return null; }, addEventListener() {} },
    navigator: { sendBeacon: (url, body) => { beacon = [url, JSON.parse(body)]; return true; } },
    tizen: { application: { getCurrentApplication: () => ({ getRequestedAppControl: () =>
      ({ appControl: { data: [{ key: 'resume', value: [film.id] }] } }) }) } },
    Shell: { init() {}, go: (name, params) => { went = [name, params.id, params.autoplay]; },
      choose: options => { asked = options; return Promise.resolve(1); } },
    Player: { open: value => { opts = value; }, isOpen: () => false },
    PStream: { startTorrentService() { started = true; }, scrape: (item, video, quality, tried, onStatus, mode) => {
      scrapedMode = mode;
      onStatus('Starting torrent engine…');
      return new Promise(resolve => { finishStream = () => { onStatus(''); resolve({ kind: 'torrent', stats: 'http://test/stats', remaining: 1, source: 'torrent' }); }; });
    } },
    AbortController, setTimeout, clearTimeout, setInterval() {},
    fetch: async url => { statsUrl = url; return { ok: true, json: async () => ({ peers: 23, downloadSpeed: 1258291, streamProgress: 0.41 }) }; }
  });
  // Home launcher integration: publish the Continue entry, and play it when Home asks.
  assert.deepEqual(beacon, ['http://127.0.0.1:8737/continue', { version: 2, continue: [{ id: film.id, title: 'Film',
    year: '', description: '', thumb: film.thumb, backdrop: '', logo: '', episode: '', positionSec: 60, durationSec: 600 }],
    sports: [{ id: 'streamed:willow', title: 'Willow', kind: 'channel', sport: 'Cricket', startsAt: 0, thumb: '' }] }]);
  assert.deepEqual(went, ['details', film.id, true]);
  const item = { source: 'pstream' }, video = { url: 'pstream:movie:1' };
  assert.equal(started, true);
  // Starting a film asks "Torrent or web stream?"; the answer reaches the scraper and is remembered.
  Data.play(item, video);
  assert.equal(opts, undefined);
  assert.equal(asked.choices.length, 2);
  assert.equal(asked.index, 0);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scrapedMode, 'web');
  assert.equal(saved.lastSource, 'web');
  assert.equal(opts.status(), 'Starting torrent engine…');
  finishStream();
  await opts.stream;
  assert.equal(await opts.status(), 'Torrent · 23 peers · 1.2 MB/s · 41 %');
  assert.equal(statsUrl, 'http://test/stats');
  opts.onProgress(120, 500);
  assert.deepEqual(history, [item, video, 120, 500]);
  assert.equal(opts.url, video.url);
  // A retry after a failure keeps the answer instead of asking again.
  asked = null;
  opts.onFailure(30);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(asked, null);
  assert.equal(scrapedMode, 'web');
}
checkPlaybackWiring().catch(error => { console.error(error); process.exitCode = 1; });

async function checkTorrentService() {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../web/js/pstream.js'), 'utf8');
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  function load({ override, ip, ipError, launchError, response } = {}) {
    let now = 0, launches = 0, requests = [], timers = new Map(), nextId = 0;
    const window = { COUCH_SECRETS: { torrentServer: override, addons: ['https://addon.example'] },
      webapis: { network: { getIp() { if (ipError) throw Error('network unavailable'); return ip; } } },
      tizen: { application: { launch(id, success, error) {
        assert.equal(id, 'CouchTor01.Service'); launches++;
        if (launchError) throw Error('launch failed');
        error();
      } } } };
    if (ip === undefined && !ipError) delete window.webapis;
    const context = { window, URL, AbortController, Date: class extends Date { static now() { return now; } },
      setTimeout(fn, ms) { timers.set(++nextId, { fn, at: now + ms }); return nextId; },
      clearTimeout(id) { timers.delete(id); },
      fetch(url, options) {
        requests.push({ url, options });
        return response ? response(requests.length, url) : Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      } };
    vm.runInNewContext(source, context);
    return { api: window.PStream, window, requests, get launches() { return launches; }, get now() { return now; },
      async tick() {
        await flush();
        const [id, timer] = Array.from(timers).sort((a, b) => a[1].at - b[1].at)[0];
        timers.delete(id); now = timer.at; timer.fn(); await flush();
      } };
  }
  for (const [options, base, host] of [
    [{ override: 'http://laptop:11470/', ip: '192.168.1.6' }, 'http://laptop:11470', 'laptop:11470'],
    [{ ip: '192.168.1.6' }, 'http://192.168.1.6:11470', 'On this TV'],
    [{}, 'http://127.0.0.1:11470', '127.0.0.1:11470'],
    [{ ipError: true }, 'http://127.0.0.1:11470', '127.0.0.1:11470'],
    [{ ip: '' }, 'http://127.0.0.1:11470', '127.0.0.1:11470']
  ]) {
    const env = load(options);
    const status = await env.api.ping(true);
    assert.equal(status.ok, true);
    assert.equal(status.host, host);
    assert.equal(env.requests[0].url, base + '/heartbeat');
    assert.equal(await env.api.waitForTorrent(), true);
    assert.equal(env.launches, 0);
  }
  let ready = false;
  const env = load({ ip: '192.168.1.6', launchError: true, response: () => ready
    ? Promise.resolve({ ok: true, json: async () => ({ success: true }) }) : new Promise(() => {}) });
  env.api.startTorrentService();
  const pending = env.api.waitForTorrent(); // shares the startup wait
  await env.tick();
  assert.equal(env.now, 1000);
  assert.equal(env.launches, 1);
  assert.equal(env.requests[0].options.signal.aborted, true);
  ready = true;
  await env.tick();
  assert.equal(await pending, true);
  assert.equal(env.requests.length, 2);

  for (const options of [{ ip: '192.168.1.6' }, { override: 'http://laptop:11470', ip: '192.168.1.6' }, {}]) {
    const down = load(Object.assign({}, options, { response: () => new Promise(() => {}) }));
    let result;
    down.api.waitForTorrent().then(ok => { result = ok; });
    for (let i = 0; result === undefined && i < 30; i++) await down.tick();
    assert.equal(result, false);
    assert.equal(down.now, 10000);
    assert.equal(down.launches, options.ip && !options.override ? 1 : 0);
  }
  const invalid = load({ response: () => Promise.resolve({ ok: true, json: async () => ({ success: false }) }) });
  assert.equal((await invalid.api.ping(true)).ok, false);

  // Couch TV ships no sources: with none set up, playing says so and the stream server reads "Not set up".
  const none = load({ ip: '192.168.1.6' });
  none.window.COUCH_SECRETS.addons = [];
  await assert.rejects(none.api.scrape({ mediaType: 'movie', tmdbId: '1', imdbId: 'tt1' }, {}, 'best'), /No sources set up/);
  const status = await none.api.ping(false);
  assert.deepEqual([status.ok, status.host], [false, 'Not set up']);
  const tv = load({ ip: '192.168.1.6' });
  const Addons = require('../web/js/addons.js');
  tv.window.Addons = Object.assign({}, Addons, { streams: async () => [
    Addons.parse({ infoHash: 'dts', title: 'Film.1080p.DTS' }),
    Addons.parse({ infoHash: 'aac', title: 'Film.720p', sources: ['tracker:udp://tracker:80/announce'] })
  ] });
  const messages = [];
  const chosen = await tv.api.scrape({ mediaType: 'movie', tmdbId: '1', imdbId: 'tt1' }, {}, 'best', [], text => messages.push(text));
  assert.equal(chosen.url, 'http://192.168.1.6:11470/aac/-1?tr=udp%3A%2F%2Ftracker%3A80%2Fannounce');
  assert.equal(chosen.stats, 'http://192.168.1.6:11470/aac/-1/stats.json?tr=udp%3A%2F%2Ftracker%3A80%2Fannounce');
  assert.deepEqual(messages, ['Starting torrent engine…', '']);
  assert.equal(tv.requests.filter(r => r.url.endsWith('/heartbeat')).length, 1);
  const laptop = load({ override: 'http://laptop:11470', ip: '192.168.1.6' });
  laptop.window.Addons = Object.assign({}, Addons, { streams: async () => [
    Addons.parse({ infoHash: 'dts', title: 'Film.1080p.DTS', sources: ['tracker:udp://tracker:80/announce'] })
  ] });
  const hls = await laptop.api.scrape({ mediaType: 'movie', tmdbId: '1', imdbId: 'tt1' }, {});
  assert.equal(new URL(hls.url).pathname, '/dts/-1/hls.m3u8');
  assert.equal(new URL(hls.url).searchParams.get('tr'), 'udp://tracker:80/announce');
  assert.equal(new URL(hls.stats).pathname, '/dts/-1/stats.json');

  for (const hasHttp of [true, false]) {
    const down = load({ ip: '192.168.1.6', response: (count, url) => url.endsWith('/heartbeat')
      ? new Promise(() => {}) : Promise.resolve({ ok: false, status: 503 }) });
    down.window.Addons = Object.assign({}, Addons, { streams: async () => [
      Addons.parse({ infoHash: 'aac', title: 'Film.1080p' })
    ].concat(hasHttp ? [Addons.parse({ url: 'https://example.com/movie.mp4' })] : []) });
    let result, failure;
    down.api.scrape({ mediaType: 'movie', tmdbId: '1', imdbId: 'tt1' }, {}).then(
      value => { result = value; }, error => { failure = error; });
    for (let i = 0; !result && !failure && i < 30; i++) await down.tick();
    assert.equal(down.now, 10000);
    if (hasHttp) assert.equal(result.kind, 'http');
    else assert.match(failure.message, /Torrent engine is not reachable/);
  }

}
checkTorrentService().then(() => process.stdout.write('ok (TV torrent service)\n')).catch(error => { console.error(error); process.exitCode = 1; });
