// Deferred artwork must stop for distant rows and resume without duplicate requests.
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
let now = 0, serial = 0;
const timers = new Map(), requests = [];
function tick(ms) {
  const end = now + ms;
  while (true) {
    const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) break;
    now = next[1].at;
    timers.delete(next[0]);
    next[1].fn();
  }
  now = end;
}
function node() {
  const classes = new Set();
  return {
    children: [], style: {}, offsetWidth: 0,
    classList: {
      add: (...names) => names.forEach(n => classes.add(n)),
      remove: (...names) => names.forEach(n => classes.delete(n)),
      toggle: (n, on) => on ? classes.add(n) : classes.delete(n)
    },
    appendChild(child) { this.children.push(child); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    set src(url) { requests.push(url); }
  };
}
const ctx = {
  window: {}, document: { createElement: node },
  setTimeout(fn, ms) { const id = ++serial; timers.set(id, { at: now + ms, fn }); return id; },
  clearTimeout(id) { timers.delete(id); }
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/js/kit.js'), 'utf8'), ctx);
const items = Array.from({ length: 20 }, (_, i) => ({ id: i, title: 'Title ' + i, thumb: 'art-' + i }));
const row = ctx.window.Kit.Row({ nearby: false });
row.setItems(items);
tick(1000);
assert.equal(requests.length, 0, 'distant rows request no artwork');
row.setNearby(true);
tick(349);
assert.equal(requests.length, 0, 'artwork waits for navigation to settle');
tick(1);
assert.equal(requests.length, 4, 'visible row artwork loads first');
row.setNearby(false);
tick(1000);
assert.equal(requests.length, 4, 'leaving a row cancels its look-ahead');
row.setNearby(true);
tick(750);
assert.equal(requests.length, 5, 'row look-ahead is bounded');
row.setNearby(true);
tick(750);
assert.equal(new Set(requests).size, requests.length, 'loaded artwork is never requested twice');
requests.length = 0;
const grid = ctx.window.Kit.Grid({ columns: 4 });
grid.setItems(items);
tick(350);
assert.equal(requests.length, 8, 'two grid rows load first');
tick(400);
assert.equal(requests.length, 12, 'grid prefetch stops after one extra row');
console.log('ok: deferred artwork, cancellation and bounded prefetch');
