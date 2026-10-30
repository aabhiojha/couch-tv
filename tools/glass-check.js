// Checks the sliding focus glass (shell.js) lands on the focused card: drives the desktop preview with
// tools/shot.js through each scenario, lets transitions settle and compares the visible glass's rect with
// the focused artwork's rendered rect (which already includes the card's 1.08 focus scale).
// Usage: [ONLY=<scenario>] node tools/glass-check.js [baseUrl] [outDir]   (serve web/: python3 -m http.server 8011)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || 'http://localhost:8011/';
const out = process.argv[3] || path.join(__dirname, '..', 'build', 'glass');
fs.mkdirSync(out, { recursive: true });

// Runs in the page. err: largest edge difference in px; glass: whether a glass is visible.
const CHECK = `(function () {
  var glass = [].filter.call(document.querySelectorAll('.focus-glass'), function (n) {
    return +getComputedStyle(n).opacity > 0.5;
  })[0] || null;
  var card = [].filter.call(document.querySelectorAll('.poster-card.focused'), function (n) {
    return n.offsetWidth;
  })[0] || null;
  var player = !!(window.Player && window.Player.isOpen());
  var rail = !!document.querySelector('.nav-rail.expanded');
  var result = { card: !!card, glass: !!glass, player: player, rail: rail };
  var cover = document.querySelector('.home-cover .cover-title');
  if (cover) result.cover = cover.textContent;
  if (card && card.closest('.kit-row')) result.row = card.closest('.kit-row').querySelector('.row-heading').textContent;
  if (card && glass) {
    var a = card.querySelector('.poster-art').getBoundingClientRect(), g = glass.getBoundingClientRect();
    result.err = +Math.max(Math.abs(a.left - g.left), Math.abs(a.top - g.top),
      Math.abs(a.right - g.right), Math.abs(a.bottom - g.bottom)).toFixed(2);
    result.size = Math.round(a.width) + 'x' + Math.round(a.height);
  }
  return JSON.stringify(result);
})()`.replace(/\n\s*/g, ' '); // shot.js echoes it on one line

const right = n => Array(n).fill('Right');
const down = n => Array(n).fill('Down');
// Presses Right every 70 ms (shot.js waits 250 ms per key), so focus moves while the row is still scrolling.
const FAST_RIGHT = `eval:(function () { var n = 0, t = setInterval(function () {
  var e = new KeyboardEvent('keydown', { bubbles: true });
  Object.defineProperty(e, 'keyCode', { get: function () { return 39; } });
  document.dispatchEvent(e);
  if (++n === 6) clearInterval(t);
}, 70); return n; })()`.replace(/\n\s*/g, ' ');
// expect: 'aligned' (glass on the card, err <= 2 px), 'hidden' (no glass visible), 'player' (hidden, player open).
// index.html is the real app (needs the network); Play on a Home card opens the player.
const only = process.env.ONLY;
const scenarios = [
  { name: 'home-first-row', page: 'dev.html', steps: [], expect: 'aligned', row: 'Continue Watching', cover: 'His Girl Friday' },
  { name: 'home-cover-next', page: 'dev.html', steps: ['Right', 'wait:700'], expect: 'aligned', row: 'Continue Watching', cover: 'The Lone Ranger' },
  { name: 'home-empty-library', page: 'dev.html', steps: ['eval:Data.clearHistory(); Data.clearMyList(); true', 'wait:400'], expect: 'aligned', row: 'Classic Films' },
  { name: 'home-row-right', page: 'dev.html', steps: [...down(3), ...right(6)], expect: 'aligned' },
  { name: 'home-row-fast', page: 'dev.html', steps: [...down(3), FAST_RIGHT, 'wait:600'], expect: 'aligned' },
  { name: 'home-down', page: 'dev.html', steps: [...down(3), ...right(2), 'Down'], expect: 'aligned' },
  { name: 'home-wide-row', page: 'dev.html', steps: [...right(2)], expect: 'aligned' },
  { name: 'home-wide-to-row', page: 'dev.html', steps: ['Right', 'Down'], expect: 'aligned' },
  { name: 'browse-grid', page: 'dev.html', steps: ['Up', 'Right', 'Enter', 'wait:1500', 'Down', ...down(3), 'Right'], expect: 'aligned' },
  { name: 'search-results', page: 'dev.html', steps: ['Up', 'Left', 'Enter', 'wait:1200', 'key:72', 'key:73', 'key:83', 'wait:1500', ...right(10), 'Right'], expect: 'aligned' },
  { name: 'details-more-like-this', page: 'dev.html', steps: ['Down', 'Down', 'Enter', 'wait:1500', ...down(6), 'Right'], expect: 'aligned' },
  { name: 'tab-bar-focused', page: 'dev.html', steps: ['Down', 'Right', 'Up', 'Up'], expect: 'hidden' },
  { name: 'exit-dialog', page: 'dev.html', steps: ['Down', 'Back', 'Back'], expect: 'hidden' },
  { name: 'player-open', page: 'index.html', steps: ['wait:5000', 'Down', 'wait:1500', 'key:415', 'wait:3000'], expect: 'player' },
];

let failed = 0;
for (const s of scenarios.filter(x => !only || x.name === only)) {
  const steps = [...s.steps, 'wait:900', 'eval:' + CHECK];
  let text;
  try {
    text = execFileSync('node', [path.join(__dirname, 'shot.js'), base + s.page, path.join(out, s.name), ...steps],
      { encoding: 'utf8' });
  } catch (e) {
    text = (e.stdout || '') + (e.stderr || '');
  }
  const line = text.split('\n').filter(l => l.startsWith('eval ')).pop() || '';
  const value = line.slice(line.lastIndexOf(' => ') + 4);
  let r = {};
  try { r = JSON.parse(JSON.parse(value)); } catch (e) { r = { error: value || text.trim() }; }
  const ok = (s.expect === 'hidden' ? r.glass === false
    : s.expect === 'player' ? r.player && r.glass === false
    : r.card && r.glass && r.err <= 2) && (!s.row || r.row === s.row) && (!s.cover || r.cover === s.cover);
  if (!ok) failed++;
  const shot = (text.match(/saved (\S+)/g) || []).pop();
  console.log((ok ? 'ok   ' : 'FAIL ') + s.name.padEnd(24) + ' ' + JSON.stringify(r) + (shot ? '  ' + shot.slice(6) : ''));
}
process.exit(failed ? 1 : 0);
