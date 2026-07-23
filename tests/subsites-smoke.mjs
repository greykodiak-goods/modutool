/* 경로형 멀티브랜드(/modutool, /modutool/img, /modutool/calc) 스모크:
   실제 서브패스 마운트로 서빙해 페이지 오류·브랜드·베이스경로를 검증. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
const PREFIX = '/modutool';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith(PREFIX + '/') && p !== PREFIX) { res.writeHead(404); res.end('outside prefix'); return; }
  p = p.slice(PREFIX.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  try { if (statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return; } } catch (e) {}
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

const CASES = [
  { url: '/', brand: 'ThisIsMyPDF' },
  { url: '/pdf-merge/', brand: 'ThisIsMyPDF' },
  { url: '/img/', brand: 'ThisIsMyIMG' },
  { url: '/img/image-compress/', brand: 'ThisIsMyIMG' },
  { url: '/img/ko/', brand: 'ThisIsMyIMG' },
  { url: '/calc/', brand: 'ThisIsMyCalculator' },
  { url: '/calc/age-calculator/', brand: 'ThisIsMyCalculator' },
];
let fails = 0;
for (const c of CASES) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const missing = [];
  page.on('response', (r) => { if (r.status() === 404) missing.push(r.url()); });
  await page.goto(base + c.url, { waitUntil: 'networkidle' });
  const headerBrand = await page.evaluate(() => {
    const el = document.querySelector('#site-header .logo');
    return el ? el.textContent.trim() : '';
  });
  const homeHref = await page.evaluate(() => {
    const el = document.querySelector('#site-header .logo');
    return el ? el.getAttribute('href') : '';
  });
  const ok = errs.length === 0 && missing.length === 0 && headerBrand.includes(c.brand.replace('ThisIsMy', ''));
  console.log((ok ? 'PASS ' : 'FAIL ') + c.url + '  [header: ' + headerBrand + ' → ' + homeHref + ']' +
    (errs.length ? ' JSERR: ' + errs.join('|') : '') + (missing.length ? ' 404: ' + missing.join(',') : ''));
  if (!ok) fails++;
  await page.close();
}
await browser.close(); server.close();
console.log('\n' + (fails ? `❌ ${fails} 실패` : '✅ 전부 통과'));
process.exit(fails ? 1 : 0);
