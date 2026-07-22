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
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const url = page.url();
await browser.close(); server.close();
const redirected = /\/login\//.test(url);
console.log('final url:', url.replace(base, ''));
console.log((errors.length === 0 ? 'PASS' : 'FAIL') + ' no page JS errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
console.log((redirected ? 'PASS' : 'FAIL') + ' unauthenticated visit redirects to login');
process.exit(errors.length === 0 && redirected ? 0 : 1);
