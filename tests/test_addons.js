const assert = require('node:assert/strict');
const calls = [];
global.fetch = function (url, options) {
  calls.push({ url, options });
  if (url.startsWith('https://slow.example/')) return new Promise(() => {});
  if (url.startsWith('https://bad.example/')) return Promise.reject(new Error('offline'));
  if (url.startsWith('https://invalid.example/')) return Promise.resolve({ ok: true, json: async () => { throw Error('bad JSON'); } });
  if (url.startsWith('https://one.example/')) return Promise.resolve({ ok: true, json: async () => ({ streams: [
    { name: 'One\n1080p', description: 'Film.2020.1080p.BluRay.x264-GRP\n👤 154 💾 2.31 GB', infoHash: 'ABC', fileIdx: 0 },
    { name: 'One\n720p', title: 'Film.2020.720p.x265\n👤 5 💾 800 MB', infoHash: 'DEF', fileIdx: 2 }
  ] }) });
  if (url.startsWith('https://two.example/')) return Promise.resolve({ ok: true, json: async () => ({ streams: [
    { name: 'Two\n1080p', description: 'Duplicate.1080p', infoHash: 'abc', fileIdx: 0 },
    { url: 'https://cdn.example/movie.mp4', name: 'HTTP', title: 'Movie.1080p' },
    { url: 'https://cdn.example/movie.mp4', name: 'Duplicate HTTP' }
  ] }) });
  throw Error('Unexpected URL ' + url);
};
const Addons = require('../web/js/addons.js');

function sample(release, extra) {
  return Addons.parse(Object.assign({ name: 'Torrentio\n1080p', description: release, infoHash: 'HASH', fileIdx: 0 }, extra), 'Torrentio');
}

(async () => {
  const movie = await Addons.streams(['https://one.example/manifest.json', 'https://two.example/', 'https://bad.example', 'https://invalid.example'], 'movie', 'tt0133093');
  assert.equal(movie.length, 3);
  assert.equal(calls[0].url, 'https://one.example/stream/movie/tt0133093.json');
  assert.equal(calls[1].url, 'https://two.example/stream/movie/tt0133093.json');
  assert(calls.every(call => call.options.signal));
  assert.equal(movie[0].title, 'Film.2020.1080p.BluRay.x264-GRP');
  assert.equal(movie[0].seeders, 154);
  assert.equal(movie[0].sizeBytes, Math.round(2.31 * 1073741824));
  assert.equal(movie[1].sizeBytes, 800 * 1048576);
  assert.equal(movie[2].kind, 'http');
  assert.equal(movie[2].infoHash, '');
  assert.equal(movie[2].fileIdx, null);
  const series = await Addons.streams(['https://one.example'], 'series', 'tt0903747:1:1');
  assert.equal(series.length, 2);
  assert(calls.some(call => call.url === 'https://one.example/stream/series/tt0903747%3A1%3A1.json'));
  assert.deepEqual(await Addons.streams([], 'movie', 'tt0133093'), []);
  assert.equal(Addons.parse({}, 'empty'), null);
  assert.equal(Addons.torrentUrl('http://server/', movie[1]), 'http://server/DEF/2');
  assert.equal(Addons.torrentUrl('http://server', sample('Film.1080p', { fileIdx: null })), 'http://server/HASH/-1');

  const tracked = sample('Film.1080p', { sources: ['dht:HASH', 'tracker:udp://tracker.example:80/announce',
    'tracker:https://tracker.example/announce?key=a&b=c', null, 42, 'tracker:'] });
  assert.deepEqual(tracked.trackers, ['udp://tracker.example:80/announce', 'https://tracker.example/announce?key=a&b=c']);
  const trackedUrl = new URL(Addons.torrentUrl('http://server/', tracked));
  assert.equal(trackedUrl.pathname, '/HASH/0');
  assert.deepEqual(trackedUrl.searchParams.getAll('tr'), tracked.trackers);
  assert.deepEqual(sample('Film').trackers, []);
  assert.deepEqual(sample('Film', { sources: 'tracker:bad' }).trackers, []);

  const tagged = sample('Film.2160p.x265.10-bit.HDR10+.DOVI.DTS-HD.TrueHD.Atmos\n👤 2 💾 900 MB');
  assert.equal(tagged.quality, 2160);
  assert.deepEqual(tagged.tags, { hevc: true, tenBit: true, hdr: true, dv: true, dts: true,
    truehd: true, atmos: true, cam: false });
  assert.equal(tagged.playable, true);
  assert.equal(tagged.needsTranscode, true);
  assert.equal(sample('Movie.UHD.HEVC.HDR').quality, 2160);
  assert.equal(sample('Movie.4K').quality, 2160);
  assert.equal(sample('Movie.480p').quality, 480);
  assert.equal(sample('Movie.H265.Hi10').playable, true);
  assert.equal(sample('Movie.1080p.Hi10P').playable, false);
  assert.equal(sample('Movie.1080p.10bit.x264').playable, false);
  assert.equal(sample('Movie.Dolby.Vision').playable, false);
  assert.equal(sample('Movie.DV.HDR').playable, true);
  for (const tag of ['CAM', 'HDCAM', 'TS', 'TELESYNC', 'HDTS']) assert.equal(sample('Movie.' + tag).playable, false, tag);
  assert.equal(sample('Movie.DTS-X').needsTranscode, true);
  assert.equal(sample('Movie.TrueHD').needsTranscode, true);
  assert.equal(sample('Movie.x264').needsTranscode, false);
  assert.equal(sample('Movie.720p', { behaviorHints: { filename: 'Movie.720p.mkv' } }).quality, 720);

  const ranking = [sample('Film.2160p\n👤 5000'), sample('Film.1080p\n👤 10'),
    sample('Film.1080p.DTS\n👤 10'), sample('Film.1080p\n👤 0'),
    Addons.parse({ url: 'https://cdn.example/film', title: 'Film.1080p\n👤 10' }, 'HTTP')];
  assert.deepEqual(Addons.rank(ranking, 'best').map(s => s.kind + ':' + s.quality + ':' + s.seeders + ':' + s.needsTranscode),
    ['http:1080:10:false', 'torrent:1080:10:false', 'torrent:1080:10:true', 'torrent:1080:0:false', 'torrent:2160:5000:false']);
  assert.equal(Addons.rank(ranking, 720)[0].quality, 1080);
  assert.deepEqual(ranking.map(s => s.quality), [2160, 1080, 1080, 1080, 1080]);
  const choices = [sample('Film.1080p\n👤 200'), sample('Film.720p\n👤 4'), sample('Film.480p\n👤 2')];
  assert.deepEqual(Addons.rank(choices, 720).map(s => s.quality), [720, 480, 1080]);
  assert.equal(Addons.rank(choices, 480)[0].quality, 480);
  assert.deepEqual(Addons.rank(choices.concat(sample('Film.2160p\n👤 1')), 2160).map(s => s.quality), [2160, 1080, 720, 480]);
  // Dotted codec names: H.265 10-bit is HEVC (playable), H.264 10-bit is Hi10P (not).
  assert.equal(sample('Film.1080p.H.265.10bit').playable, true);
  assert.equal(sample('Film.1080p.H.264.10bit').playable, false);
  assert.equal(Addons.rank([sample('Film.1080p\n👤 200'), Addons.parse({ url: 'https://cdn.example/film', title: 'Film.1080p' }, 'HTTP')], 'best')[0].kind, 'http');

  // Fake timers make the eight-second timeout deterministic without waiting or touching the network.
  const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout;
  let timeout;
  global.setTimeout = function (fn, ms) { assert.equal(ms, 8000); timeout = fn; return 1; };
  global.clearTimeout = function () {};
  try {
    const pending = Addons.streams(['https://slow.example'], 'movie', 'tt0133093');
    await Promise.resolve();
    timeout();
    assert.deepEqual(await pending, []);
    assert.equal(calls[calls.length - 1].options.signal.aborted, true);
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
  process.stdout.write('ok\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
