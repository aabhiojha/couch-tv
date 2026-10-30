// Opens a live-stream embed page in headless Chrome and prints the first HLS playlist it requests,
// with the Referer/Origin its CDN expects, as JSON ({"url", "referer", "origin"}). Exits 1 if none in 20 s.
// Usage: node tools/live-sniff.mjs <embed URL> [referer]
import { createRequire } from 'module';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const { chromium } = require(execSync('npm root -g').toString().trim() + '/playwright');
const [embed, referer] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('popup', popup => popup.close().catch(() => {}));
const found = new Promise((resolve) => page.on('request', async (request) => {
  if (!/\.m3u8$/.test(new URL(request.url()).pathname)) return;
  const h = await request.allHeaders().catch(() => ({}));
  resolve({ url: request.url(), referer: h.referer || new URL(embed).origin + '/',
    origin: h.origin || new URL(embed).origin });
}));
page.goto(embed, { referer, waitUntil: 'domcontentloaded' }).catch(() => {});
const result = await Promise.race([found, new Promise((resolve) => setTimeout(resolve, 20000, null))]);
await browser.close();
if (result) console.log(JSON.stringify(result));
process.exit(result ? 0 : 1); // without this the 20 s timer keeps Node running
