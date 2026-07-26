/* 오프라인(PWA) 검증 — 한 번 방문 후 네트워크를 완전히 끊고도 도구가 동작하는지.
   서비스워커는 로컬에서 기본 비활성이라 localStorage['mdtl-sw-force']='1'로 강제한다.
   (127.0.0.1은 보안 컨텍스트로 취급돼 SW 등록 자체는 가능) */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
const PREFIX = '/modutool';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
let online = true, served = 0;
const server = createServer((req, res) => {
  if (!online) { req.socket.destroy(); return; }        // 오프라인 흉내: 연결 자체를 끊는다
  served++;
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith(PREFIX + '/') && p !== PREFIX) { res.writeHead(404); res.end('outside'); return; }
  p = p.slice(PREFIX.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  try {
    if (statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
      res.end(readFileSync(f));
      return;
    }
  } catch (e) {}
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

const ctx = await browser.newContext();
await ctx.addInitScript(() => { try { localStorage.setItem('mdtl-sw-force', '1'); } catch (e) {} });
const page = await ctx.newPage();

/* 1) 첫 방문 — 매니페스트가 붙어 있고 SW가 등록·활성화된다 */
await page.goto(base + '/pdf/', { waitUntil: 'networkidle' });

const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
ok(manifestHref === PREFIX + '/pdf/manifest.webmanifest', `매니페스트 링크 = ${manifestHref}`);

const mf = await page.evaluate((h) => fetch(h).then((r) => r.json()), manifestHref);
ok(mf.name === 'ThisIsMyPDF', `매니페스트 name=${mf.name}`);
ok(mf.start_url === PREFIX + '/pdf/' && mf.scope === PREFIX + '/pdf/', `start_url/scope=${mf.start_url}`);
ok(Array.isArray(mf.icons) && mf.icons.length > 0, '매니페스트 아이콘 존재');

const reg = await page.evaluate(() =>
  navigator.serviceWorker.ready.then((r) => ({ scope: r.scope, active: !!r.active })).catch((e) => ({ err: String(e) })));
ok(reg.active === true, `SW 활성화 (scope=${reg.scope})`);

const swBody = await page.evaluate((u) => fetch(u).then((r) => r.text()), PREFIX + '/pdf/sw.js');
ok(!/__BUILD_ID__/.test(swBody), '빌드ID가 sw.js에 치환됨(플레이스홀더 없음)');

/* 2) 도구 페이지를 한 번 방문해 캐시에 태운다 */
await page.goto(base + '/pdf/pdf-merge/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
ok(true, 'SW가 페이지를 제어 중(controller 존재)');

/* 온라인 상태에서 픽스처 PDF 2개를 만들어 둔다(오프라인 병합 검증용 입력) */
const fixtures = await page.evaluate(async () => {
  const mk = async (n) => {
    const d = await PDFLib.PDFDocument.create();
    for (let i = 0; i < n; i++) d.addPage([200, 200]);
    const b = await d.save();
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s);
  };
  return { a: await mk(1), b: await mk(2) };
});
ok(!!fixtures.a && !!fixtures.b, '픽스처 PDF 생성(온라인)');

/* 3) 네트워크 차단 후 재방문 — 캐시로 살아나는지 */
online = false;
const before = served;
const resp = await page.goto(base + '/pdf/pdf-merge/', { waitUntil: 'domcontentloaded' });
ok(resp && resp.status() === 200, `오프라인 재방문 HTTP ${resp && resp.status()}`);
ok(served === before, `오프라인 동안 서버 요청 0건(실제 ${served - before}건)`);

const offlineState = await page.evaluate(() => ({
  css: getComputedStyle(document.body).backgroundColor,      // site.css가 적용됐나
  js: typeof window.mdtlLogEvent,                            // site.js가 실행됐나
  drop: !!document.querySelector('.drop, #drop, input[type=file]'),
  title: document.title,
}));
ok(offlineState.js === 'function', '오프라인에서 site.js 로드됨');
ok(offlineState.css !== '' && offlineState.css !== 'rgba(0, 0, 0, 0)', `오프라인에서 site.css 적용됨 (${offlineState.css})`);
ok(offlineState.drop, '오프라인에서 파일 입력 UI 존재');
ok(/Merge/i.test(offlineState.title), `오프라인 문서 제목 = ${offlineState.title}`);

/* 3-b) 핵심 증명 — 네트워크가 완전히 끊긴 상태에서 실제로 PDF를 병합한다 */
const dec = (s) => Buffer.from(s, 'base64');
await page.setInputFiles('#dz input[type=file]', [
  { name: 'a.pdf', mimeType: 'application/pdf', buffer: dec(fixtures.a) },
  { name: 'b.pdf', mimeType: 'application/pdf', buffer: dec(fixtures.b) },
]);
await page.waitForFunction(() => document.querySelectorAll('#grid .pdf-card').length === 2, null, { timeout: 20000 });
ok(true, '오프라인에서 파일 2개 적재(썸네일 렌더 — pdf.js도 캐시에서)');
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.click('#mergeBtn'),
]);
const bytes = await dl.createReadStream().then((s) => new Promise((res, rej) => {
  const c = []; s.on('data', (d) => c.push(d)); s.on('end', () => res(Buffer.concat(c))); s.on('error', rej);
}));
ok(bytes.slice(0, 5).toString() === '%PDF-', '오프라인 병합 결과가 PDF');
const pageCount = await page.evaluate(async (b64) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return (await PDFLib.PDFDocument.load(u)).getPageCount();
}, bytes.toString('base64'));
ok(pageCount === 3, `오프라인 병합 결과 ${pageCount}쪽 (1+2=3)`);
ok(served === before, `병합 중에도 서버 요청 0건(실제 ${served - before}건)`);

/* 4) 오프라인에서 미방문 페이지는 홈 셸로 폴백(하드 실패 화면이 아니어야 한다) */
const r2 = await page.goto(base + '/pdf/pdf-split/', { waitUntil: 'domcontentloaded' });
ok(r2 && r2.status() === 200, `미방문 페이지 오프라인 폴백 HTTP ${r2 && r2.status()}`);

/* 5) 텔레메트리 엔드포인트는 캐시 대상이 아니다(민감 경로 차단 확인) */
const apiCached = await page.evaluate(() =>
  caches.keys().then((ks) => Promise.all(ks.map((k) => caches.open(k).then((c) => c.keys()))))
    .then((lists) => lists.flat().map((r) => r.url).filter((u) => /convex|supabase|doubleclick|googlesyndication|daumcdn/.test(u))));
ok(apiCached.length === 0, `API·광고 응답 캐시 없음 (발견 ${apiCached.length}건)`);

online = true;
await ctx.close();
await browser.close();
server.close();
console.log(fails === 0 ? '\n오프라인 PWA 전체 통과' : `\n실패 ${fails}건`);
process.exit(fails ? 1 : 0);
