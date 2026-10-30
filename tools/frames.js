// Frame-drop QA on the TV: attaches to a running Couch TV inspector, presses remote keys through four scenarios
// at a person's pace, and reports dropped frames (from requestAnimationFrame gaps) and long main-thread tasks.
// Usage: CDP=127.0.0.1:9342 [PROFILE=1] node tools/frames.js [off:shimmer,parallax,pill,fade,clicks,cover,images]
//   PROFILE=1 also prints the functions that took the most CPU in each scenario; CSS='…' injects extra CSS (experiments).
//   (start the app with `sdb shell 0 debug CouchTV001.CouchTV` and `sdb forward tcp:<port> tcp:<inspector port>`;
//   the TV ends debug sessions after a minute or two, so keep runs short)
const endpoint = process.env.CDP || '127.0.0.1:9342';
const off = (process.argv[2] || '').replace(/^off:/, '').split(',').filter(Boolean);

// CSS that switches one effect off, to compare against a run with everything on.
const OFF = {
  shimmer: '.poster-art.image-loading:after,.skeleton-block:after{display:none!important;animation:none!important}',
  parallax: '.poster-logo{transition:none!important}',
  pill: '.kit-pill>div{transition:none!important}',
  fade: '.screen-enter{animation:none!important}',
  // Diagnostics: Home's backdrop, and all card artwork.
  cover: '.cover-image{display:none!important}',
  images: '.poster-image,.poster-logo{display:none!important}',
};
const SETUP = `(function () {
  var css = ${JSON.stringify(off.map(k => OFF[k] || '').join('') + (process.env.CSS || ''))};
  if (css) { var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }
  ${off.includes('clicks') ? "window.__clicks = Data.settings().navClicks; Data.setSetting('navClicks', false);" : ''}
  window.__fq = {
    start: function () {
      var q = this, last = performance.now();
      q.frames = []; q.long = []; q.on = true;
      (function tick(t) { if (!q.on) return; q.frames.push(t - last); last = t; requestAnimationFrame(tick); })(last);
      if (!q.observer && window.PerformanceObserver) {
        try {
          q.observer = new PerformanceObserver(function (list) {
            if (q.on) list.getEntries().forEach(function (e) { q.long.push(Math.round(e.duration)); });
          });
          q.observer.observe({ entryTypes: ['longtask'] });
        } catch (e) { /* no long-task timing */ }
      }
    },
    stop: function () {
      this.on = false;
      var f = this.frames.slice(2), dropped = 0, worst = 0;
      f.forEach(function (d) { if (d > 20) dropped += Math.round(d / 16.7) - 1; if (d > worst) worst = d; });
      return { frames: f.length, dropped: dropped, worst: Math.round(worst), over50: f.filter(function (d) { return d > 50; }).length,
        longTasks: this.long.length, longest: this.long.length ? Math.max.apply(null, this.long) : 0 };
    },
    key: function (code) {
      ['keydown', 'keyup'].forEach(function (type) {
        var e = new KeyboardEvent(type, { bubbles: true });
        Object.defineProperty(e, 'keyCode', { value: code });
        document.dispatchEvent(e);
      });
    }
  };
  return 1;
})()`;

const L = 37, U = 38, R = 39, D = 40, OK = 13;
const SCENARIOS = [
  { name: 'home row', setup: "Shell.go('home')", keys: [D, R, R, R, R, R, R, R, R, L, L, L, L, L, L, L, L] },
  { name: 'home rows', setup: "Shell.go('home')", keys: [D, D, D, D, D, U, U, U, U, U] },
  { name: 'tab bar', setup: "Shell.go('home')", keys: [U, R, R, R, R, L, L, L, L, D] },
  { name: 'movies grid', setup: "Shell.go('movies')", keys: [D, D, D, D, D, D, R, R, U, U, U, U] },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const page = (await (await fetch('http://' + endpoint + '/json')).json()).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || {}); pending.delete(msg.id); }
  });
  const send = (method, params) => new Promise(r => {
    const n = ++id;
    pending.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const run = expression => send('Runtime.evaluate', { expression, returnByValue: true }).then(r => r.result && r.result.value);
  const profiling = !!process.env.PROFILE;
  if (profiling) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 500 }); }
  // Self time by function, from the CPU profile's samples; (program)/(idle)/(garbage collector) included.
  const hottest = profile => {
    const byId = new Map(profile.nodes.map(n => [n.id, n])), self = new Map();
    const deltas = profile.timeDeltas || [];
    (profile.samples || []).forEach((sid, i) => {
      const f = byId.get(sid).callFrame;
      const key = (f.functionName || '(anonymous)') + ' ' + (f.url ? f.url.split('/').pop() + ':' + (f.lineNumber + 1) : '');
      self.set(key, (self.get(key) || 0) + (deltas[i] || 0) / 1000);
    });
    return [...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, ms]) => '    ' + String(Math.round(ms)).padStart(6) + ' ms  ' + k).join('\n');
  };

  await run(SETUP);
  console.log('effects off:', off.join(', ') || 'none');
  for (const s of SCENARIOS) {
    await run(s.setup);
    await sleep(2500); // let the screen load and settle before measuring
    if (profiling) await send('Profiler.start');
    await run('__fq.start()');
    for (const code of s.keys) { await run('__fq.key(' + code + ')'); await sleep(320); }
    await sleep(800);
    const r = await run('__fq.stop()');
    console.log(s.name.padEnd(12), JSON.stringify(r));
    if (profiling) console.log(hottest((await send('Profiler.stop')).profile));
  }
  if (off.includes('clicks')) await run("Data.setSetting('navClicks', window.__clicks)");
  ws.close();
})().catch(e => { console.error(e); process.exit(1); });
