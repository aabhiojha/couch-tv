const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Live = require('../web/js/live.js');
const main = fs.readFileSync(require.resolve('../web/js/main.js'), 'utf8');
const start = main.indexOf('  Data.playLive = function');
const end = main.indexOf("  window.addEventListener('error'", start);
assert.ok(start >= 0 && end > start);
const opened = [], messages = [];
const failing = { resolver: { lastError: { at: Date.now(), message: 'the player changed' } } };
const context = { Data: { sportsHealth: () => Promise.resolve(failing) }, Live, liveAttempt: 0, setTimeout, Date,
  Player: { open: options => opened.push(options) },
  Shell: { choose: () => Promise.resolve(1), toast: text => messages.push(text) } };
vm.runInNewContext(main.slice(start, end), context);
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
(async () => {
  const event = { title: 'Match', kind: 'event', startsAt: Date.now() - 1000,
    streams: [0, 1, 2, 3].map(i => ({ url: 'http://relay/' + i, label: 'Feed ' + i, language: 'en' })) };
  context.Data.playLive(event, { index: 1 }); // the watch option chosen on the Sports screen
  await pause();
  assert.equal(opened[0].url, 'http://relay/1');
  assert.equal(opened[0].onFailure(), true);
  opened[0].onClose();
  await pause();
  assert.equal(opened[1].url, 'http://relay/0');
  assert.equal(opened[1].onFailure(), true);
  opened[1].onClose();
  await pause();
  assert.equal(opened[2].url, 'http://relay/2');
  assert.equal(opened[2].onFailure(), false); // Three distinct sources; no endless retry loop.
  opened[2].onClose();
  context.Data.playLive({ ...event, startsAt: Date.now() + 3600000 });
  assert.match(messages[messages.length - 1], /Starts/);
  assert.equal(opened.length, 3);
  context.Data.playLive(event, { direct: true }); // the Play key skips the choice
  await pause();
  assert.equal(opened[3].url, 'http://relay/0');
  opened[3].onClose();
  context.Data.playLive({ ...event, streams: [event.streams[0]] });
  const cancelled = opened[4];
  cancelled.onClose();
  cancelled.onFailure();
  await pause();
  assert.equal(opened.length, 5);
  assert.ok(!messages.some(m => /resolving/.test(m))); // closed players never toast
  // Every feed failed and the TV's resolver is broken: the toast says where to look.
  context.Data.playLive({ ...event, streams: [event.streams[0]] });
  assert.equal(opened[5].onFailure(), false);
  await pause();
  assert.match(messages[messages.length - 1], /Settings › Sports streams/);
  console.log('ok test_live_playback (selection, bounded fallback, future guard, Play key, cancellation, resolver toast)');
})().catch(error => { console.error(error); process.exit(1); });
