// Where a move's time goes on the TV: traces one tools/frames.js scenario under the inspector and prints the
// busiest timeline events per thread, plus the page's layer count and memory.
// Usage: CDP=127.0.0.1:9342 node tools/trace.js "home row"|"home rows"|"tab bar"|"movies grid"|idle [extra-css]
const endpoint = process.env.CDP || '127.0.0.1:9342';
const scenario = process.argv[2] || 'home row';
const css = process.argv[3] || '';
const L = 37, U = 38, R = 39, D = 40;
const SCENARIOS = {
  'home row': ["Shell.go('home')", [D, R, R, R, R, R, R, R, R, L, L, L, L, L, L, L, L]],
  'home rows': ["Shell.go('home')", [D, D, D, D, D, U, U, U, U, U]],
  'tab bar': ["Shell.go('home')", [U, R, R, R, R, L, L, L, L, D]],
  'movies grid': ["Shell.go('movies')", [D, D, D, D, D, D, R, R, U, U, U, U]],
  idle: ["Shell.go('home')", []], // nothing pressed for 4 s: should cost nothing
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const page = (await (await fetch('http://' + endpoint + '/json')).json()).find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0, layers = null;
  const pending = new Map(), events = [];
  let done;
  const finished = new Promise(r => { done = r; });
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result || {}); pending.delete(m.id); }
    if (m.method === 'Tracing.dataCollected') events.push(...m.params.value);
    if (m.method === 'Tracing.tracingComplete') done();
    if (m.method === 'LayerTree.layerTreeDidChange' && m.params.layers) layers = m.params.layers;
  });
  const send = (method, params) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const run = expression => send('Runtime.evaluate', { expression, returnByValue: true }).then(r => r.result && r.result.value);
  const key = code => run(`(function(){['keydown','keyup'].forEach(function(t){var e=new KeyboardEvent(t,{bubbles:true});Object.defineProperty(e,'keyCode',{value:${code}});document.dispatchEvent(e);});})()`);

  if (css) await run(`(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`);
  const [setup, keys] = SCENARIOS[scenario];
  await run(setup);
  await sleep(3000);
  await send('LayerTree.enable');
  await sleep(500);
  await send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,gpu,blink.image_decode' + (process.env.INVALIDATIONS ? ',disabled-by-default-devtools.timeline.invalidationTracking' : ''), transferMode: 'ReportEvents' });
  for (const code of keys) { await key(code); await sleep(320); }
  await sleep(keys.length ? 800 : 4000);
  await send('Tracing.end');
  await finished;
  const memory = await run('JSON.stringify(performance.memory ? { usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576), totalMB: Math.round(performance.memory.totalJSHeapSize / 1048576) } : {})');
  const counts = await run("JSON.stringify({ nodes: document.getElementsByTagName('*').length, images: document.images.length, loaded: Array.prototype.filter.call(document.images, function (i) { return i.complete && i.naturalWidth; }).length })");

  const names = {};
  events.filter(e => e.ph === 'M' && e.name === 'thread_name').forEach(e => { names[e.pid + ':' + e.tid] = e.args.name; });
  const byThread = {};
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const thread = (names[e.pid + ':' + e.tid] || String(e.tid)).replace(/\d+$/, 'N');
    const t = byThread[thread] = byThread[thread] || {};
    t[e.name] = t[e.name] || { ms: 0, n: 0, max: 0 };
    t[e.name].ms += e.dur / 1000; t[e.name].n++; t[e.name].max = Math.max(t[e.name].max, e.dur / 1000);
  }
  console.log(scenario + (css ? ' (with css)' : '') + ': ' + keys.length + ' keys over ' + (keys.length * 0.32 + 0.8).toFixed(1) + ' s');
  // What reaches the screen: frames the compositor submitted. A gap of 20–250 ms mid-animation is a visible drop
  // (longer gaps are just nothing moving).
  const submits = events.filter(e => e.name === 'AsyncLayerTreeFrameSink::SubmitCompositorFrame' && e.ph === 'X').map(e => e.ts / 1000).sort((a, b) => a - b);
  let shown = 0, lost = 0, worstGap = 0;
  for (let i = 1; i < submits.length; i++) {
    const gap = submits[i] - submits[i - 1];
    if (gap > 250) continue;
    shown++;
    if (gap > 20) { lost += Math.round(gap / 16.7) - 1; worstGap = Math.max(worstGap, gap); }
  }
  console.log('  on screen: ' + shown + ' frames drawn, ' + lost + ' dropped, worst gap ' + Math.round(worstGap) + ' ms');
  // GAPS=1: what each thread was busy with during the three longest on-screen gaps.
  if (process.env.GAPS) {
    const gaps = [];
    for (let i = 1; i < submits.length; i++) if (submits[i] - submits[i - 1] > 40 && submits[i] - submits[i - 1] < 250) gaps.push([submits[i - 1], submits[i]]);
    gaps.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    const tname = e => (names[e.pid + ':' + e.tid] || String(e.tid)).replace(/\d+$/, 'N');
    for (const [a, b] of gaps.slice(0, 3)) {
      console.log('  gap ' + Math.round(b - a) + ' ms:');
      const inside = events.filter(e => e.ph === 'X' && e.dur > 8000 && e.ts / 1000 < b && (e.ts + e.dur) / 1000 > a)
        .sort((x, y) => y.dur - x.dur).slice(0, 10);
      inside.forEach(e => console.log('    ' + String(Math.round(e.dur / 1000)).padStart(5) + ' ms  ' + tname(e).padEnd(28) + e.name));
    }
  }
  console.log('  layers ' + (layers ? layers.length + ', ' + Math.round(layers.reduce((a, l) => a + l.width * l.height, 0) / 1e6) + ' MP' : '?') + '  heap ' + memory + '  dom ' + counts);
  for (const [thread, list] of Object.entries(byThread)) {
    const top = Object.entries(list).sort((a, b) => b[1].ms - a[1].ms).slice(0, 8).filter(([, v]) => v.ms >= 5);
    if (!top.length) continue;
    console.log('  ' + thread);
    top.forEach(([name, v]) => console.log('    ' + String(Math.round(v.ms)).padStart(6) + ' ms  ' + String(v.n).padStart(5) + 'x  max ' + String(Math.round(v.max)).padStart(4) + '  ' + name));
  }
  // Painted area per layer (Paint events carry the layer and the clip quad), named by the layer's element.
  const painted = {};
  for (const e of events) {
    if (e.name !== 'Paint' || !e.args || !e.args.data) continue;
    const d = e.args.data, q = d.clip || [];
    const area = q.length === 8 ? Math.abs((q[2] - q[0]) * (q[5] - q[1])) : 0;
    const k = d.layerId;
    painted[k] = painted[k] || { px: 0, n: 0 };
    painted[k].px += area; painted[k].n++;
  }
  const top = Object.entries(painted).sort((a, b) => b[1].px - a[1].px).slice(0, 8);
  if (top.length) {
    await send('DOM.getDocument', { depth: 0 });
    console.log('  repainted (megapixels, paints, layer element)');
    for (const [layerId, v] of top) {
      const layer = (layers || []).find(l => String(l.layerId) === String(layerId));
      let what = 'layer ' + layerId;
      if (layer && layer.backendNodeId) {
        const r = await send('DOM.describeNode', { backendNodeId: layer.backendNodeId });
        const n = r.node || {}, attrs = n.attributes || [];
        const cls = attrs[attrs.indexOf('class') + 1];
        what = (n.nodeName || '?').toLowerCase() + (attrs.indexOf('class') >= 0 ? '.' + String(cls).split(' ').join('.') : '') + (n.pseudoType ? '::' + n.pseudoType : '');
      } else if (layer) what += ' (' + layer.width + 'x' + layer.height + ')';
      console.log('    ' + (v.px / 1e6).toFixed(1).padStart(6) + ' MP  ' + String(v.n).padStart(4) + 'x  ' + what);
    }
  }
  // What invalidated paint, by element and reason (INVALIDATIONS=1).
  if (process.env.INVALIDATIONS) {
    const why = {};
    for (const e of events) {
      if (e.name !== 'PaintInvalidationTracking' || !e.args || !e.args.data) continue;
      const d = e.args.data, k = (d.nodeName || '?') + '  ' + (d.reason || '');
      why[k] = (why[k] || 0) + 1;
    }
    // Card-title invalidations per key press (each slot is one 320 ms key interval), to find the press that causes them.
    const titles = events.filter(e => e.name === 'PaintInvalidationTracking' && e.args && e.args.data && /poster-title/.test(e.args.data.nodeName || '')).map(e => e.ts);
    const start = Math.min.apply(null, events.filter(e => e.ts > 0).map(e => e.ts));
    const slots = keys.map(() => 0);
    titles.forEach(ts => { const i = Math.floor((ts - start) / 320000); if (i >= 0 && i < slots.length) slots[i]++; });
    console.log('  title invalidations per key [' + keys.join(',') + ']: ' + slots.join(' '));
    console.log('  paint invalidations (count, element, reason)');
    Object.entries(why).sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, n]) => console.log('    ' + String(n).padStart(5) + '  ' + k.slice(0, 110)));
  }
  // The biggest layers: what the GPU composites every frame.
  if (process.env.LAYERS && layers) {
    await send('DOM.getDocument', { depth: 0 });
    console.log('  biggest layers (on-screen MP, size, element)');
    const onScreen = l => Math.max(0, Math.min(1920, l.offsetX + l.width) - Math.max(0, l.offsetX)) * Math.max(0, Math.min(1080, l.offsetY + l.height) - Math.max(0, l.offsetY));
    for (const l of layers.filter(l => l.drawsContent).sort((a, b) => onScreen(b) - onScreen(a)).slice(0, 12)) {
      let what = '?';
      if (l.backendNodeId) {
        const n = (await send('DOM.describeNode', { backendNodeId: l.backendNodeId })).node || {}, a = n.attributes || [];
        what = (n.nodeName || '?').toLowerCase() + (a.indexOf('class') >= 0 ? '.' + String(a[a.indexOf('class') + 1]).split(' ').join('.') : '');
      }
      console.log('    ' + (onScreen(l) / 1e6).toFixed(2).padStart(6) + ' MP  ' + (l.width + 'x' + l.height).padEnd(11) + ' ' + what);
    }
  }
  ws.close();
})().catch(e => { console.error(e); process.exit(1); });
