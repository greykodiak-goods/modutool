import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  try { if (statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return; } } catch (e) {}
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const pages = ['pdf-merge', 'pdf-split', 'pdf-to-jpg', 'img-to-pdf', 'image-compress', 'image-resize', 'image-crop', 'image-convert', 'pdf-page-numbers', 'pdf-sign'];
let fails = 0;
for (const slug of pages) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/${slug}/`, { waitUntil: 'domcontentloaded' });
  const hasLog = await page.evaluate(() => typeof window.mdtlLogEvent === 'function');
  await page.waitForTimeout(120);
  const ok = errs.length === 0 && hasLog;
  console.log((ok ? 'PASS ' : 'FAIL ') + slug + (errs.length ? ' errors: ' + errs.join(' | ') : '') + (hasLog ? '' : ' (mdtlLogEvent missing)'));
  if (!ok) fails++;
  await page.close();
}
await browser.close(); server.close();
console.log('\n' + (fails ? `❌ ${fails} 페이지 실패` : '✅ 전 페이지 통과'));
process.exit(fails ? 1 : 0);
