/* 모바일 스모크 — 제품계약(product-contract)의 모바일 조항 이행:
   "320px에서도 잘림·가로 스크롤 없음". 페이지 몸통이 뷰포트보다 넓으면 실패.
   사용: node tests/mobile-smoke.mjs  (사전조건: 우산 빌드가 dist/에 있음) */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadChromium, launchOptions, distDir } from './_pw.mjs';

const chromium = loadChromium();
const ROOT = distDir();
const PREFIX = '/modutool';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith(PREFIX + '/') && p !== PREFIX) { res.writeHead(404); res.end('outside'); return; }
  p = p.slice(PREFIX.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  try { if (statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return; } } catch (e) {}
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;

/* 대표 흐름 페이지 — 허브·핵심 도구·상거래, 한·영 포함 */
const PAGES = ['/', '/pdf/', '/pdf/pdf-merge/', '/pdf/ko/pdf-merge/', '/pdf/ko/pricing/', '/img/image-compress/', '/calc/age-calculator/', '/video/video-trim/', '/pdf/privacy/'];

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 320, height: 658 } });
let fails = 0;
for (const path of PAGES) {
  await page.goto(base + path, { waitUntil: 'networkidle' });
  const m = await page.evaluate(() => ({
    scrollW: document.scrollingElement.scrollWidth,
    innerW: window.innerWidth,
    // 어떤 요소가 넘치는지 진단용 상위 3개
    wide: [...document.querySelectorAll('*')]
      .filter((el) => el.scrollWidth > window.innerWidth + 1 && getComputedStyle(el).overflowX !== 'auto' && getComputedStyle(el).overflowX !== 'scroll')
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : ''}(${el.scrollWidth}px)`),
  }));
  const ok = m.scrollW <= m.innerW + 1; // 반올림 1px 허용
  console.log(`${ok ? 'PASS' : 'FAIL'} ${path.padEnd(22)} 몸통 ${m.scrollW}px / 뷰포트 ${m.innerW}px${ok ? '' : ' · 넘침: ' + m.wide.join(', ')}`);
  if (!ok) fails++;
}
await browser.close();
server.close();

if (fails) {
  console.error(`\n❌ 모바일 320px 스모크 실패 ${fails}페이지 — 가로 스크롤 발생`);
  process.exit(1);
}
console.log('\n✅ 모바일 320px 스모크 통과 — 전 페이지 가로 스크롤 없음');
