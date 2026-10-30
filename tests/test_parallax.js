// The logo effect must use the active screen without reading layout during a key press.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../web/js/shell.js'), 'utf8');
const helper = source.match(/  function parallax\(code\) \{[\s\S]*?\n  \}/)[0];
const frames = [], logo = { style: {} };
let selectedLogo = logo;
const active = { screen: { el: { querySelector(selector) {
  assert.equal(selector, '.poster-card.focused .poster-logo');
  return selectedLogo;
} } } };
let entry = active;
const run = vm.runInNewContext('(' + helper + ')', {
  current: () => entry,
  stage: { querySelectorAll() { throw new Error('must not search cached screens'); } },
  requestAnimationFrame: fn => frames.push(fn)
});
run(39);
assert.equal(logo.style.transform, 'translate(-18px,0px)');
while (frames.length) frames.shift()();
assert.equal(logo.style.transform, '');
assert.equal(logo.style.transition, '');
selectedLogo = null;
run(40);
assert.equal(frames.length, 0, 'cards without logos do no animation work');
entry = null;
run(39);
assert.equal(frames.length, 0, 'no screen means no animation');
console.log('ok: active-screen logo movement and reset, no cached-screen layout scan');
