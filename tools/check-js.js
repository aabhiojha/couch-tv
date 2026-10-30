// Fails if any web/ JS can't be parsed by Chromium 76 (ES2019) or CSS uses features it lacks.
// Usage: node tools/check-js.js
const fs = require('fs');
const path = require('path');
// acorn from npm (CI: npm install --no-save acorn@8.12.1), else the copy bundled with emsdk.
let acorn;
try { acorn = require('acorn'); } catch (e) { acorn = require(path.join(process.env.HOME, 'emsdk/upstream/emscripten/node_modules/acorn')); }

const web = path.join(__dirname, '..', 'web');
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html)$/.test(f)) files.push(p);
  }
})(web);

const cssBanned = [
  [/(^|[^-\w])gap\s*:/m, 'flexbox gap (use margins, or grid-gap for grids)'],
  [/aspect-ratio\s*:/, 'aspect-ratio'],
  [/(^|[^-\w])inset\s*:/m, 'inset'],
  [/:is\(|:where\(|:focus-visible/, ':is()/:where()/:focus-visible'],
];
const jsBanned = [
  [/\.replaceAll\(/, 'String.replaceAll'], [/\.at\(-?\d/, 'Array.at'], [/Object\.hasOwn\(/, 'Object.hasOwn'],
  [/structuredClone\(/, 'structuredClone'], [/Promise\.(any|allSettled)\(/, 'Promise.any/allSettled'],
];

let bad = 0;
function fail(file, msg) { bad++; console.error(path.relative(web, file) + ': ' + msg); }

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const scripts = f.endsWith('.js') ? [src]
    : f.endsWith('.html') ? [...src.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]) : [];
  const styles = f.endsWith('.css') ? [src]
    : f.endsWith('.html') ? [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]) : [];
  for (const js of scripts) {
    try { acorn.parse(js, { ecmaVersion: 2019, sourceType: 'script' }); }
    catch (e) { fail(f, 'not ES2019: ' + e.message); }
    for (const [re, name] of jsBanned) if (re.test(js)) fail(f, 'uses ' + name);
  }
  for (const css of styles) for (const [re, name] of cssBanned) if (re.test(css)) fail(f, 'uses ' + name);
}
if (bad) process.exit(1);
console.log('ok');
