// Drive a page in headless Chrome with remote-control keys; save screenshots and print JS errors.
// Lets the UI be reviewed off the TV.
// Usage: node tools/shot.js <url> <outPrefix> [step...]
//   steps: Left Right Up Down Enter Back Space | key:<keyCode> | wait:<ms> | shot | eval:<js expression>
//   (a final shot is always taken)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEYS = {
  Left: [37, 'ArrowLeft'], Right: [39, 'ArrowRight'], Up: [38, 'ArrowUp'], Down: [40, 'ArrowDown'],
  Enter: [13, 'Enter'], Back: [27, 'Escape'], Space: [32, ' '],
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const [url, out, ...steps] = process.argv.slice(2);
  if (!url || !out) { console.error('usage: node tools/shot.js <url> <outPrefix> [step...]'); process.exit(2); }
  // CDP=host:port attaches to an already running inspector (e.g. the TV, via `sdb forward`);
  // url "-" then means "don't navigate".
  const attach = process.env.CDP;
  const endpoint = attach || '127.0.0.1:' + (9300 + Math.floor(Math.random() * 600));
  const profile = attach ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'shot-'));
  const chrome = attach ? null : spawn('google-chrome', ['--headless=new',
    '--remote-debugging-port=' + endpoint.split(':')[1], '--user-data-dir=' + profile, '--window-size=1920,1080',
    '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    try {
      const page = (await (await fetch('http://' + endpoint + '/json')).json()).find(t => t.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch (e) { await sleep(200); }
  }
  await new Promise(r => ws.addEventListener('open', r));

  let id = 0;
  const pending = new Map();
  let errors = 0;
  ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors++; console.log('JS EXCEPTION:', msg.params.exceptionDetails.exception
        ? msg.params.exceptionDetails.exception.description : msg.params.exceptionDetails.text);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && /error|warning/.test(msg.params.type)) {
      console.log('console.' + msg.params.type + ':', msg.params.args.map(a => a.value || a.description).join(' '));
    }
  });
  const send = (method, params) => new Promise(r => {
    const n = ++id;
    pending.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
    setTimeout(() => { if (pending.delete(n)) { console.log('no reply to', method); r({}); } }, 15000);
  });

  await send('Runtime.enable');
  if (!attach) await send('Page.enable'); // the TV's inspector never answers this
  if (!attach) await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  if (url !== '-') { await send('Page.navigate', { url }); await sleep(2500); }

  let n = 0;
  const shot = async () => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    if (!data) return; // not supported (the TV's inspector)
    const file = out + '-' + String(++n).padStart(2, '0') + '.png';
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('saved', file);
  };
  for (const step of steps) {
    if (step === 'shot') await shot();
    else if (step.startsWith('wait:')) await sleep(+step.slice(5));
    else if (step.startsWith('eval:')) {
      const r = await send('Runtime.evaluate', { expression: step.slice(5), returnByValue: true });
      console.log('eval', step.slice(5), '=>', r.exceptionDetails
        ? 'THREW ' + (r.result && r.result.description) : JSON.stringify(r.result && r.result.value));
    }
    else if (KEYS[step] || step.startsWith('key:')) {
      const [code, key] = KEYS[step] || [+step.slice(4), String.fromCharCode(+step.slice(4))];
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, key });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, key });
      await sleep(250);
    } else console.log('unknown step', step);
  }
  await shot();
  ws.close();
  if (chrome) {
    const exited = new Promise(r => chrome.on('exit', r));
    chrome.kill();
    await exited;
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
  if (errors) process.exit(1);
})();
