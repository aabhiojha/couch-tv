// web/js/data.js: the library (progress, Continue Watching, My List, settings, recent searches) and
// the TMDB catalog mapping (rows, browse, search).
// Usage: node tests/test_data.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
// Values come from another vm realm, so compare structurally via JSON.
const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));

const source = fs.readFileSync(path.join(__dirname, '../web/js/data.js'), 'utf8');
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};

const fixtures = {}; // url -> text served by the fake fetch
let clock = 1e12; // tick Date.now() so "newest first" is deterministic
class TestDate extends Date { static now() { return (clock += 1000); } }
const lists = []; // PStream.list calls: [path, params, page]
const PStream = {
  list: (path, params, page) => { lists.push([path, params, page]); return Promise.resolve({ items: [{ id: 'tmdb:movie:' + lists.length, backdrop: 'b', description: 'd' }], total: 1 }); },
  search: (q, page) => Promise.resolve({ items: [{ id: 'tmdb:movie:9', title: q }], total: 1, page }),
  images: item => { images.push(item.mediaType + ':' + item.tmdbId); return Promise.resolve({ logo: '/logo.png', backdrop: '/clean.jpg' }); },
};
const images = []; // PStream.images calls
function load() {
  const ctx = { window: {}, PStream, localStorage, console, Date: TestDate, JSON, Math, Object, Promise, String, isFinite, parseInt, setTimeout, clearTimeout, fetch: url => Promise.resolve({ ok: true, text: () => Promise.resolve(fixtures[url] || '') }) };
  vm.runInNewContext(source, ctx);
  return ctx.window.Data;
}

const ep = n => ({ url: 'u' + n, title: 'Ep ' + n, durationSec: 1000, season: 1, episode: n, subtitles: [] });
const series = { id: 'tmdb:tv:1', title: 'Show', year: '1950', thumb: 't', rating: 4, isSeries: true,
                 videos: [ep(1), ep(2), ep(3)] };
const film = { id: 'tmdb:movie:2', title: 'Film', year: '1940', thumb: 'f', rating: 0, isSeries: false,
               videos: [{ url: 'f1', title: 'Film', durationSec: 5000, season: 0, episode: 0, subtitles: [] }] };

let Data = load();
let changes = 0;
Data.onChange(() => changes++);

eq(Data.continueWatching(), []);
assert.strictEqual(Data.nextVideo(series, series.videos[0]).url, 'u2');
assert.strictEqual(Data.nextVideo(series, series.videos[2]), null);
assert.strictEqual(Data.nextVideo(film, film.videos[0]), null);

Data.setProgress(film, film.videos[0], 10, 5000);           // < 30 s: not worth resuming
eq(Data.continueWatching(), []);
Data.setProgress(film, film.videos[0], 600, 5000);
let cw = Data.continueWatching();
assert.strictEqual(cw.length, 1);
assert.strictEqual(cw[0].video.url, 'f1');
assert.strictEqual(Data.resumeFrom('f1'), 595);

Data.setProgress(series, series.videos[0], 990, 1000);     // finished ep 1 → offer ep 2 from the start
cw = Data.continueWatching();
assert.strictEqual(cw.length, 2);
assert.strictEqual(cw[0].item.id, 'tmdb:tv:1');                  // newest first
assert.strictEqual(cw[0].video.url, 'u2');
assert.strictEqual(cw[0].positionSec, 0);

Data.setProgress(series, series.videos[2], 999, 1000);     // finished the last episode → gone
eq(Data.continueWatching().map(e => e.item.id), ['tmdb:movie:2']);

Data.removeFromContinue('tmdb:movie:2');
eq(Data.continueWatching(), []);

assert.strictEqual(Data.toggleMyList(film), true);
assert.strictEqual(Data.toggleMyList(series), true);
eq(Data.myList().map(i => i.id), ['tmdb:tv:1', 'tmdb:movie:2']);
assert.strictEqual(Data.myList()[0].videos, undefined);      // only the summary is stored
const toggle = Data.toggleMyList;                             // works unbound
assert.strictEqual(toggle(film), false);
assert.strictEqual(Data.inMyList('tmdb:movie:2'), false);

for (let i = 0; i < 10; i++) Data.addRecentSearch('q' + i);
Data.addRecentSearch('  Q5 ');
Data.addRecentSearch('   ');
eq(Data.recentSearches(), ['Q5', 'q9', 'q8', 'q7', 'q6', 'q4', 'q3', 'q2']);

Data.setSetting('subtitles', true);
assert.strictEqual(Data.settings().autoplayNext, true);
assert.strictEqual(Data.settings().sourceOrder, 'addons-first');
Data.setSetting('sourceOrder', 'provider-first');
assert.strictEqual(load().settings().sourceOrder, 'provider-first');
assert(changes > 0);

// Everything survives a relaunch.
Data = load();
assert.strictEqual(Data.settings().subtitles, true);
eq(Data.myList().map(i => i.id), ['tmdb:tv:1']);
assert.strictEqual(Data.recentSearches()[0], 'Q5');
assert.strictEqual(Data.getProgress('u3').positionSec, 999);

Data.clearHistory();
Data.clearMyList();
Data.clearRecentSearches();
eq([Data.continueWatching(), Data.myList(), Data.recentSearches()], [[], [], []]);
assert.strictEqual(Data.getProgress('u3'), null);

// Time formatting and resume rules.
eq(['0:00', '1:05', '1:02:05', '0:00', '0:00'], [0, 65.9, 3725, -1, NaN].map(Data.formatTime));
Data.setProgress(film, film.videos[0], 29, 100); assert.strictEqual(Data.resumeFrom('f1'), 0);
Data.setProgress(film, film.videos[0], 30, 100); assert.strictEqual(Data.resumeFrom('f1'), 25);
Data.setProgress(film, film.videos[0], 96, 100); assert.strictEqual(Data.resumeFrom('f1'), 0);
Data.setProgress(film, film.videos[0], 40, 0); assert.strictEqual(Data.resumeFrom('f1'), 35);
Data.clearHistory();

// Obsolete caches are removed on start.
store['couch.rows.v2'] = 'x'.repeat(1000);
load();
assert.strictEqual(store['couch.rows.v2'], undefined);

// Corrupt storage starts fresh instead of crashing.
store['couch.library.v2'] = '{not json';
eq(load().myList(), []);
console.log('ok');

// Subtitles: SRT and WebVTT parsing (ported from the C++ core's tests, same fixtures).
(async () => {
  const D = load();
  fixtures.srt = fs.readFileSync(path.join(__dirname, 'fixtures/subtitles_sample.srt'), 'utf8');
  fixtures.vtt = fs.readFileSync(path.join(__dirname, 'fixtures/subtitles_sample.vtt'), 'utf8');
  fixtures.custom = '\uFEFFWEBVTT\r\n\r\nNOTE source\r\nignore\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\nb\r\n00:02.5 --> 00:03.0 align:start\r\n <i>Hello &amp; <c.x>world</c></i> {\\an8}\r\n Next&#39; line \r\n\r\na\r\n00:01.0 --> 00:01.5\r\nfirst\r\n\r\n00:04.0 --> 00:04.0\r\ninvalid\r\n\r\n00:05.0 --> 00:06.0\r\nunfinished';
  fixtures.complete = '00:01.0 --> 00:02.0\ncomplete\n';
  fixtures.noNewline = '1\n00:00:01,000 --> 00:00:02,000\nno newline at end';
  fixtures.cut = '1\n00:00:01,000 --> 00:00:0';
  const srt = await D.loadSubtitles('srt');
  assert.strictEqual(srt.length, 61);
  assert(Math.abs(srt[0].start - 61.95) < 1e-5 && Math.abs(srt[0].end - 68.94) < 1e-5);
  const vtt = await D.loadSubtitles('vtt');
  assert(vtt.length > 100);
  eq([vtt[0].start, vtt[0].end], [0, 2]);
  const custom = await D.loadSubtitles('custom');
  eq(custom.map(c => c.start), [1, 2.5, 5]);
  assert.strictEqual(custom[1].text, "Hello & world\nNext' line");
  assert.strictEqual((await D.loadSubtitles('complete')).length, 1);
  assert.strictEqual((await D.loadSubtitles('noNewline')).length, 1);
  assert.strictEqual((await D.loadSubtitles('cut')).length, 0);
  console.log('ok (subtitles)');
})().catch(e => { console.error(e); process.exit(1); });

// Catalog: Home rows, Movies/Series browse and search all come from TMDB.
(async () => {
  const D = load();
  const day = new Date(clock).toISOString().slice(0, 10);
  assert.strictEqual(D.rows[0].key, 'trending');
  await D.loadRow('trending', 2);
  eq(lists.pop(), ['trending/all/week', {}, 2]);
  await D.loadRow('hindi-series', 3);
  const [path, params] = lists.pop();
  assert.strictEqual(path, 'discover/tv');
  assert.strictEqual(params.with_original_language, 'hi');
  assert.strictEqual(params.without_genres, '10763,10767');     // no talk shows or news
  assert.strictEqual(params['first_air_date.lte'], day);        // nothing unreleased
  await assert.rejects(D.loadRow('feature_films', 1));            // archive rows are gone

  await D.browse('movies', 'hi', 'top', 1);
  let q = lists.pop();
  assert.strictEqual(q[0], 'discover/movie');
  eq([q[1].with_original_language, q[1].sort_by, q[1].with_genres], ['hi', 'vote_average.desc', undefined]);
  await D.browse('series', '18', 'title', 2);
  q = lists.pop();
  eq([q[0], q[1].with_genres, q[1].sort_by, q[2]], ['discover/tv', '18', 'name.asc', 2]);
  assert(D.sections[0].filters.some(f => f.title === 'Hindi'));

  // First pages are cached across launches; later pages are not.
  lists.length = 0;
  await D.loadRow('popular-movies', 1);
  await load().loadRow('popular-movies', 1);
  assert.strictEqual(lists.length, 1);

  eq((await D.search('  dangal ', 1)).items[0].title, 'dangal');
  eq(await D.search('   ', 1), { items: [], total: 0 });

  // Archive titles left in an old library are dropped on load.
  store['couch.library.v2'] = JSON.stringify({ myList: [{ id: 'his_girl_friday' }, { id: 'tmdb:movie:5' }],
    items: { his_girl_friday: {}, 'tmdb:movie:5': {} },
    progress: { a: { itemId: 'his_girl_friday' }, b: { itemId: 'tmdb:movie:5' } } });
  const old = load();
  eq(old.myList().map(i => i.id), ['tmdb:movie:5']);
  assert.strictEqual(old.getProgress('a'), null);
  assert(old.getProgress('b'));

  // Artwork: logos and textless backdrops are looked up once per title and cached across launches.
  PStream.list = () => Promise.resolve({ total: 2, items: [
    { id: 'tmdb:movie:7', mediaType: 'movie', thumb: 'old' }, { id: 'tmdb:movie:7', mediaType: 'movie', thumb: 'old' }] });
  images.length = 0;
  let art = await load().loadRow('top-movies', 2);
  eq(images, ['movie:7']);
  eq([art.items[0].logo, art.items[0].logoLarge, art.items[0].thumb, art.items[1].backdrop], [
    'https://image.tmdb.org/t/p/w300/logo.png', 'https://image.tmdb.org/t/p/w500/logo.png',
    'https://image.tmdb.org/t/p/w500/clean.jpg', 'https://image.tmdb.org/t/p/w1280/clean.jpg']);
  await new Promise(r => setTimeout(r, 1100));                 // the art cache is saved in one batch
  images.length = 0;
  art = await load().loadRow('top-movies', 3);
  eq(images, []);
  assert.strictEqual(art.items[0].logo, 'https://image.tmdb.org/t/p/w300/logo.png');
  // Because You Watched: seeded by the latest watched title, one request per seed.
  let relatedCalls = 0;
  PStream.related = seed => { relatedCalls++; return Promise.resolve([{ id: seed.id }, { id: 'tmdb:movie:8' }]); };
  const B = load();
  assert.strictEqual(await B.becauseYouWatched(), null);
  B.setProgress(Object.assign({ mediaType: 'movie' }, film), film.videos[0], 100, 5000);
  const because = await B.becauseYouWatched();
  eq([because.title, because.items.map(i => i.id)], ['Because You Watched Film', ['tmdb:movie:8']]);
  await B.becauseYouWatched();
  assert.strictEqual(relatedCalls, 1);
  PStream.list = () => Promise.resolve({ total: 1, items: [
    { id: 'tmdb:movie:999999', mediaType: 'movie', thumb: 'fallback' }] });
  PStream.images = () => new Promise(() => {}); // a slow optional artwork lookup
  const quick = await Promise.race([
    load().loadRow('trending', 2),
    new Promise((_, reject) => setTimeout(() => reject(new Error('row waited for artwork')), 100))
  ]);
  assert.strictEqual(quick.items[0].thumb, 'fallback');
  let finishArt;
  PStream.images = () => new Promise(resolve => { finishArt = resolve; });
  const late = await load().loadRow('trending', 2);
  finishArt({ logo: '/logo.png', backdrop: '/clean.jpg' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(late.items[0].thumb, 'https://image.tmdb.org/t/p/w500/clean.jpg');
  console.log('ok (catalog)');
})().catch(e => { console.error(e); process.exit(1); });

// New Episodes: a caught-up series whose latest episode aired lately; behind, old or already played ones stay out.
(async () => {
  delete store['couch.library.v2']; delete store['couch.airing.v1']; // other blocks keep their artwork and rows
  const aired = {}; // tmdb id -> last aired episode
  PStream.lastAired = id => Promise.resolve(aired[id] || null);
  const day = ms => new Date(ms).toISOString().slice(0, 10);
  const sep = n => Object.assign(ep(n), { url: 'pstream:show:1:1:' + n }); // real progress URLs carry season and episode
  const show = Object.assign({}, series, { videos: [sep(1), sep(2), sep(3)] });
  const N = load();
  N.setProgress(show, sep(3), 1000, 1000); // finished the last listed episode: caught up
  aired['1'] = { season: 1, episode: 4, airDate: day(clock - 2 * 86400000) };
  let fresh = await N.newEpisodes();
  eq(fresh.map(i => [i.id, i.badge]), [['tmdb:tv:1', 'New Episode']]);
  // A show whose only episode never started playing isn't followed.
  const tried = Object.assign({}, series, { id: 'tmdb:tv:7', videos: [Object.assign(ep(1), { url: 'pstream:show:7:1:1' })] });
  N.setProgress(tried, tried.videos[0], 0, 0);
  aired['7'] = { season: 1, episode: 9, airDate: day(clock) };
  eq((await N.newEpisodes()).map(i => i.id), ['tmdb:tv:1']);
  // Cached for 6 h: a different answer now isn't fetched.
  aired['1'] = { season: 2, episode: 1, airDate: day(clock) };
  eq((await N.newEpisodes()).map(i => i.badge), ['New Episode']);
  // Opening the show brings the new episode into Continue Watching, which then owns it.
  PStream.detail = () => Promise.resolve(Object.assign({}, show, { videos: [sep(1), sep(2), sep(3), sep(4)] }));
  await N.loadItem('tmdb:tv:1');
  eq(N.continueWatching().map(e => e.video.url), ['pstream:show:1:1:4']);
  eq(await N.newEpisodes(), []);
  // My List series: a season premiere is "New Season"; one that aired 40 days ago is not new.
  const M = load();
  delete store['couch.airing.v1'];
  M.clearHistory();
  M.toggleMyList({ id: 'tmdb:tv:5', title: 'Saved', kind: 'series' });
  M.toggleMyList({ id: 'tmdb:tv:6', title: 'Old', kind: 'series' });
  aired['5'] = { season: 3, episode: 1, airDate: day(clock) };
  aired['6'] = { season: 1, episode: 9, airDate: day(clock - 40 * 86400000) };
  eq((await M.newEpisodes()).map(i => [i.id, i.badge]), [['tmdb:tv:5', 'New Season']]);
  console.log('ok (new episodes)');
})().catch(e => { console.error(e); process.exit(1); });

// Sports bookmarks: toggled, kept in step with the schedule, and a match drops off 12 h after it starts.
{
  delete store['couch.library.v2'];
  const S = load();
  const match = { id: 'streamed:m1', title: 'Arsenal vs Chelsea', kind: 'event', sport: 'Football', startsAt: clock + 3600000, streams: [] };
  assert.strictEqual(S.toggleSportsBookmark(match), true);
  assert.strictEqual(S.toggleSportsBookmark({ id: 'streamed:willow', title: 'Willow', kind: 'channel', sport: 'Cricket' }), true);
  eq(S.sportsBookmarks().map(s => s.id), ['streamed:willow', 'streamed:m1']);
  S.updateSportsBookmarks([Object.assign({}, match, { startsAt: clock - 13 * 3600000 })]); // it was long ago after all
  eq(load().sportsBookmarks().map(s => s.id), ['streamed:willow']); // saved, and pruned on read
  assert.strictEqual(S.toggleSportsBookmark({ id: 'streamed:willow' }), false);
  eq(S.sportsBookmarks(), []);
  console.log('ok (sports bookmarks)');
}
