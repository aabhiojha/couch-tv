const assert = require('node:assert/strict');
const Live = require('../web/js/live.js');

const list = Live.parse([
  '#EXTM3U',
  '#EXTINF:-1 tvg-id="DDSports.in@SD" tvg-logo="https://logo/dd.png" group-title="Sports",DD Sports (1080p)',
  'http://a.example/dd.m3u8',
  '#EXTINF:-1 tvg-id="ACC.us@SD" tvg-name="A, B" group-title="Outdoor;Sports",ACC, Network',
  '#EXTVLCOPT:http-user-agent=x',
  'https://b.example/acc.m3u8',
  '#EXTINF:-1 group-title="VOD",Some Film',
  'http://host/movie/u/p/1.mkv',
  '#EXTINF:-1,No Attributes',
  'http://c.example/live/u/p/3.ts'
].join('\r\n'));
assert.equal(list.length, 3);
assert.deepEqual(list[0], { title: 'DD Sports (1080p)', thumb: 'https://logo/dd.png', group: 'Sports', country: 'IN', source: '',
  id: 'live:http://a.example/dd.m3u8', url: 'http://a.example/dd.m3u8' });
assert.equal(list[1].title, 'ACC, Network');
assert.equal(list[1].group, 'Sports');
assert.equal(list[1].country, 'US');
assert.equal(list[2].group, 'Other');

// One group (iptv-org sports) → country tabs; several groups → group tabs.
const sports = list.slice(0, 2).concat(Live.parse('#EXTINF:-1 tvg-id="X.in@HD" group-title="Sports",X\nhttp://x/1'));
assert.deepEqual(Live.groups(sports).map(g => g.key), ['all', 'IN', 'US']);
assert.equal(Live.groups(sports)[1].field, 'country');
assert.deepEqual(Live.groups(list).map(g => g.key), ['all', 'Sports', 'Other']);

// Same channel from several playlists → one channel with labelled streams; the title loses its notes.
const merged = Live.merge(Live.parse([
  '#EXTINF:-1 group-title="Cricket" couch-source="PPV · Willow 2",Willow',
  'http://relay/play/1.m3u8',
  '#EXTINF:-1 tvg-logo="https://logo/w.png" group-title="Sports",Willow HD (1080p) [Geo-blocked]',
  'http://iptv/willow.m3u8',
  '#EXTINF:-1 group-title="Sports",Other',
  'http://iptv/other.m3u8'
].join('\n')), { 'http://iptv/willow.m3u8': 'iptv-org', 'http://iptv/other.m3u8': 'iptv-org' });
assert.equal(merged.length, 2);
assert.equal(merged[0].title, 'Willow');
assert.equal(merged[0].group, 'Cricket');
assert.equal(merged[0].thumb, 'https://logo/w.png');
assert.deepEqual(merged[0].streams, [{ url: 'http://relay/play/1.m3u8', label: 'PPV · Willow 2' },
  { url: 'http://iptv/willow.m3u8', label: 'iptv-org · 1080p · Geo-blocked' }]);
assert.deepEqual(merged[1].streams, [{ url: 'http://iptv/other.m3u8', label: 'iptv-org' }]);

const now = new Date(2026, 9, 26, 20, 0).getTime();
const hour = 3600000;
const fixtures = [
  { id: 'live', kind: 'event', title: 'Nepal vs India', sport: 'Cricket', startsAt: now - hour,
    endsAt: now + hour, streams: [{ url: 'http://relay/en', language: 'en' }, { url: 'http://relay/hi', language: 'hi' },
      { url: 'http://relay/ne', language: 'ne' }, { url: 'http://relay/es', language: 'es' }] },
  { id: 'next', kind: 'event', title: 'Next', sport: 'Football', startsAt: now + hour, endsAt: now + 3 * hour,
    streams: [{ url: 'http://relay/next', language: '' }] },
  { id: 'ended', kind: 'event', title: 'Ended', sport: 'Cricket', startsAt: now - 3 * hour, endsAt: now,
    streams: [{ url: 'http://relay/ended', language: 'hi' }] },
  { id: 'unknown', kind: 'event', title: 'Unknown end', sport: 'Cricket', startsAt: now - 9 * hour, endsAt: 0,
    streams: [{ url: 'http://relay/unknown', language: 'en' }] },
  { id: 'channel', kind: 'channel', title: 'Channel', sport: 'Cricket', startsAt: 0, endsAt: 0,
    streams: [{ url: 'http://relay/channel', language: '' }] }
];
assert.equal(Live.state(fixtures[0], now), 'Scheduled now');
assert.equal(Live.state(fixtures[2], now), 'Ended');
assert.equal(Live.state(fixtures[3], now), 'Status unknown');
assert.deepEqual(Live.select(fixtures, 'now', 'all', 'preferred', now).map(x => x.id), ['live']);
assert.deepEqual(Live.select(fixtures, 'upcoming', 'all', 'preferred', now).map(x => x.id), ['next']);
assert.equal(Live.select(fixtures, 'upcoming', 'all', 'hi', now).length, 0);
assert.deepEqual(Live.select(fixtures, 'now', 'Cricket', 'hi', now)[0].streams.map(x => x.language), ['hi']);
assert.deepEqual(Live.select(fixtures, 'now', 'all', 'preferred', now)[0].streams.map(x => x.language), ['en', 'hi', 'ne']);
assert.equal(Live.select(fixtures, 'channels', 'all', 'preferred', now)[0].meta, 'Cricket');
assert.equal(Live.language('en-US'), 'en');
assert.equal(Live.languageName('ne'), 'Nepali');
assert.equal(Live.languageName(''), 'Unspecified');
assert.equal(Live.relayUrl(['http://lan:8790/live.m3u']), 'http://lan:8790/sports.json');
assert.equal(Live.relayUrl([], 'http://lan:8790/'), 'http://lan:8790/sports.json');
assert.equal(Live.relayUrl(['https://public.example/channels.m3u']), '');
assert.throws(() => Live.readCatalog({ items: [] }));
assert.equal(Live.readCatalog({ items: [{ ...fixtures[0], streams: [{ url: 'javascript:bad' }] }], providers: [null] }).items[0].streams.length, 0);
const crossing = { ...fixtures[0], startsAt: new Date(2026, 9, 25, 23).getTime(), endsAt: now + hour };
assert.equal(Live.select([crossing], 'today', 'all', 'preferred', now).length, 1);

// An unknown end stays "Scheduled now" for the sport's usual length: a football match for 2.5 h, cricket for 8 h.
const openEnded = { ...fixtures[3], sport: 'Football', startsAt: now - 2 * hour };
assert.equal(Live.state(openEnded, now), 'Scheduled now');
assert.equal(Live.state(openEnded, now + hour), 'Status unknown');
assert.equal(Live.state({ ...fixtures[3], startsAt: now - 7 * hour }, now), 'Scheduled now');
assert.equal(Live.timing(fixtures[1], now), 'Starts in 1 h');
assert.equal(Live.timing({ ...fixtures[1], startsAt: now + 3 * hour + 10 * 60000 }, now), 'Starts in 3 h 10 min');
assert.equal(Live.timing({ ...fixtures[1], startsAt: now + 50 * hour }, now), 'Starts in 2 days');
assert.equal(Live.timing(fixtures[0], now), 'Started 1 h ago');
assert.equal(Live.timing(fixtures[2], now), '');
assert.equal(Live.timing(fixtures[4], now), '');
assert.equal(Live.select(fixtures, 'upcoming', 'all', 'preferred', now)[0].badge, 'In 1 h');
assert.equal(Live.select([{ ...fixtures[1], startsAt: now + 30 * hour }], 'upcoming', 'all', 'all', now)[0].badge, 'Upcoming');
assert.match(Live.startLabel({ startsAt: now + 5 * hour }, now), /^Tomorrow, /);
// Today: on now first, then later today, then ended or unknown.
const today = [{ ...fixtures[2], id: 'done', startsAt: now - 5 * hour }, { ...fixtures[1], startsAt: now + 2 * hour },
  { ...fixtures[0], startsAt: now - 30 * 60000 }];
assert.deepEqual(Live.select(today, 'today', 'all', 'all', now).map(x => x.id), ['live', 'next', 'done']);
// The sport row lists only sports in the view, most listed first.
const mixed = [fixtures[0], { ...fixtures[0], id: 'b', sport: 'Football' }, { ...fixtures[0], id: 'c', sport: 'Football' }];
assert.deepEqual(Live.sportsIn(mixed, 'now', 'preferred', now), ['Football', 'Cricket']);
assert.deepEqual(Live.sportsIn(fixtures, 'upcoming', 'preferred', now), ['Football']);
// Cricket and football only: catalog sports are kept or dropped by name; playlist channels by their title.
assert.equal(Live.sportOf({ kind: 'event', sport: 'Football' }), 'Football');
assert.equal(Live.sportOf({ kind: 'event', sport: 'American Football' }), '');
assert.equal(Live.sportOf({ kind: 'channel', sport: '24/7 Streams', title: 'Sky Sports Football' }), '');
assert.equal(Live.sportOf({ kind: 'channel', sport: '', title: 'Star Sports 1 Hindi' }), 'Cricket');
assert.equal(Live.sportOf({ kind: 'channel', sport: '', title: 'Willow HD' }), 'Cricket');
assert.equal(Live.sportOf({ kind: 'channel', sport: '', title: 'beIN Sports 1' }), 'Football');
assert.equal(Live.sportOf({ kind: 'channel', sport: '', title: 'Premier League TV' }), 'Football');
assert.equal(Live.sportOf({ kind: 'channel', sport: '', title: 'NFL Football Network' }), '');
assert.equal(Live.sportOf({ kind: 'channel', sport: '', title: 'ACC Network' }), '');
// Catalog (relay) channels come before playlist channels.
const lineup = [{ ...fixtures[4], id: 'a', title: 'Alpha' }, { ...fixtures[4], id: 'z', title: 'Zulu', scheduled: true },
  { ...fixtures[4], id: 'c', title: 'Cartoons', sport: '24/7 Streams', scheduled: true }];
assert.deepEqual(Live.select(lineup, 'channels', 'all', 'all', now).map(x => x.id), ['z', 'c', 'a']);

(async () => {
  const calls = [];
  global.fetch = (url) => {
    calls.push(url);
    if (url === 'https://down.example/') return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: true, text: async () => '#EXTINF:-1,One\nhttp://one\n#EXTINF:-1,Dup\nhttp://one\n#EXTINF:-1,Willow HD\nhttp://willow' });
  };
  const fetched = await Live.channels(['https://down.example/', 'https://up.example/']);
  assert.deepEqual(fetched.map(c => c.title), ['One', 'Willow HD']);
  assert.deepEqual(fetched[0].streams, [{ url: 'http://one', label: 'up' }]);
  await Live.channels(['https://up.example/']); // cached for the session
  assert.equal(calls.length, 2);
  const catalogCalls = [];
  global.fetch = url => {
    catalogCalls.push(url);
    return Promise.resolve({ ok: true, text: async () => JSON.stringify({ items: fixtures,
      providers: [{ name: 'Example', status: 'ok', updatedAt: now }] }) });
  };
  global.fetch = url => {
    catalogCalls.push(url);
    return Promise.resolve({ ok: true, text: async () => JSON.stringify({ items: fixtures.concat([{ id: 'nba',
      kind: 'event', title: 'Lakers vs Celtics', sport: 'Basketball', startsAt: now, streams: [{ url: 'http://relay/nba' }] }]),
      providers: [{ name: 'Example', status: 'ok', updatedAt: now }] }) });
  };
  // The playlist channels ("One", "Willow HD") come from the session cache above; only Willow is cricket.
  const result = await Live.sports(['http://lan:8790/live.m3u', 'https://up.example/']);
  assert.equal(result.items.filter(x => x.kind === 'event').length, 4); // the basketball event is left out
  assert.deepEqual(result.items.filter(x => x.kind === 'channel').map(x => x.title), ['Channel', 'Willow HD']);
  catalogCalls.length = 0;
  await Live.sports(['http://lan:8790/live.m3u']);
  assert.equal(catalogCalls.length, 0);
  assert.equal(result.scheduleError, false);
  const realNow = Date.now;
  try {
    const time = realNow();
    Date.now = () => time + 61000;
    global.fetch = () => Promise.reject(new Error('Relay offline'));
    const stale = await Live.sports(['http://lan:8790/live.m3u']);
    assert.equal(stale.stale, true);
    assert.equal(stale.items.filter(x => x.kind === 'channel')[0].scheduled, true);
    assert.equal(stale.items.filter(x => x.kind === 'event').length, 4);
    Date.now = () => time + 7 * 3600000;
    const expired = await Live.sports(['http://lan:8790/live.m3u']);
    assert.equal(expired.items.length, 0);
    assert.equal(expired.scheduleError, true);
    // A failed schedule is retried after 10 s rather than held for the usual minute.
    let retried = 0;
    global.fetch = () => { retried++; return Promise.reject(new Error('Relay offline')); };
    Date.now = () => time + 7 * 3600000 + 11000;
    await Live.sports(['http://lan:8790/live.m3u']);
    assert.equal(retried, 1);
  } finally { Date.now = realNow; }
  console.log('ok test_live');
})().catch(e => { console.error(e); process.exit(1); });

// Settings › Sports streams: a newer failure than success means the resolver is broken; a test outranks both.
{
  const now = 10 * 3600000;
  const module = { bytes: 188166, hash: '3fa1c2d9', fetchedAt: now - 3600000 };
  assert.equal(Live.health(null, now).value, 'Not on this TV');
  assert.equal(Live.health({ down: true }, now).state, 'down');
  assert.equal(Live.health({ resolver: {}, schedule: { status: 'none' } }, now).value, 'Not tested');
  const ok = Live.health({ resolver: { module, lastOk: { at: now - 720000, ms: 5614 } }, schedule: { status: 'ok' } }, now);
  assert.deepEqual(ok, { state: 'ok', value: 'Working', text: 'Last stream found 12 min ago, in 5.6 s · module 3fa1c2d9' });
  const broken = { resolver: { module, lastOk: { at: now - 7200000, ms: 1 }, lastError: { at: now - 60000, message: 'lock.wasm has no set_stream_jw: the player changed' } },
    schedule: { status: 'stale', updatedAt: now - 1800000 } };
  assert.deepEqual(Live.health(broken, now), { state: 'down', value: 'Failing',
    text: 'Failed 1 min ago: lock.wasm has no set_stream_jw: the player changed · schedule from 30 min ago' });
  assert.equal(Live.health(Object.assign({ test: { ok: true, title: 'Willow Cricket', ms: 4200 } }, broken), now).text,
    'Found a stream for Willow Cricket in 4.2 s · module 3fa1c2d9 · schedule from 30 min ago');
  assert.equal(Live.health({ resolver: { lastOk: { at: now, ms: 1 } }, test: { ok: false, message: 'timed out' } }, now).value, 'Failing');
}

// Scores from the TV service: kept with https crests only; a malformed score is dropped.
{
  const read = Live.readCatalog({ providers: [], items: [
    { id: 'a', title: 'Arsenal vs Chelsea', kind: 'event', startsAt: 1, streams: [],
      score: { state: 'in', line: "ARS 2 – 1 CHE · 67'", summary: '', crests: ['https://a/ars.png', 'javascript:x', 'https://a/che.png'] } },
    { id: 'b', title: 'Nepal vs UAE', kind: 'event', startsAt: 1, streams: [], score: { state: 'in' } }] });
  assert.deepEqual(read.items[0].score, { state: 'in', line: "ARS 2 – 1 CHE · 67'", summary: '', crests: ['https://a/ars.png', 'https://a/che.png'] });
  assert.equal(read.items[1].score, null);
}
