/* 자체호스팅(폐쇄망) 번들 검증 — 이 번들의 상품성은 "외부로 아무것도 안 나간다"는 점 하나다.
   그러니 검증도 그것이어야 한다: 도구를 실제로 돌리는 동안 우리 서버 밖으로 나가는 요청이 0건인가.

   말로 하는 보안 주장은 값이 없다. 브라우저가 실제로 만든 요청 목록을 세서 증명한다.
   사용: OFFLINE=1 SITE=pdf node scripts/build.mjs https://tools.internal /tmp/offline-pdf
        node tests/offline-bundle.mjs /tmp/offline-pdf */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = process.argv[2] || '/tmp/offline-pdf';
if (!existsSync(ROOT)) {
  console.error(`번들이 없습니다: ${ROOT}\n먼저: OFFLINE=1 SITE=pdf node scripts/build.mjs https://tools.internal ${ROOT}`);
  process.exit(1);
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };

/* 사내 서버 흉내. 여기로 오는 요청만 "내부", 나머지는 전부 "외부 유출"로 센다. */
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  try { if (statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return; } } catch (e) {}
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

const external = [];
const ctx = await browser.newContext();
ctx.on('request', (r) => {
  const u = r.url();
  if (u.startsWith(origin) || u.startsWith('data:') || u.startsWith('blob:')) return;
  external.push(u);
});

const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e)));

/* 1) 허브가 뜨고, 백엔드 의존 화면은 제거돼 있어야 한다 */
await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
ok((await page.locator('.tool-tile, .tile').count()) > 0, '허브에 도구 목록 표시');
for (const p of ['/login/', '/signup/', '/account/', '/admin/', '/pricing/']) {
  const r = await page.request.get(origin + p);
  ok(r.status() === 404, `백엔드 의존 화면 제거됨: ${p} (${r.status()})`);
}
const footerDead = await page.locator('#site-footer a[href*="pricing"], #site-footer a[href*="contact"]').count();
ok(footerDead === 0, '푸터에 죽은 링크 없음');

/* 2) 실제 작업 — PDF 2개 병합 */
await page.goto(`${origin}/pdf-merge/`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof PDFLib !== 'undefined', null, { timeout: 20000 });
const fx = await page.evaluate(async () => {
  const mk = async (n) => {
    const d = await PDFLib.PDFDocument.create();
    for (let i = 0; i < n; i++) d.addPage([200, 200]);
    const b = await d.save();
    let s = ''; for (const x of b) s += String.fromCharCode(x);
    return btoa(s);
  };
  return { a: await mk(1), b: await mk(2) };
});
const buf = (s) => Buffer.from(s, 'base64');
await page.setInputFiles('#dz input[type=file]', [
  { name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(fx.a) },
  { name: 'b.pdf', mimeType: 'application/pdf', buffer: buf(fx.b) },
]);
await page.waitForFunction(() => document.querySelectorAll('#grid .pdf-card').length === 2, null, { timeout: 20000 });
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.click('#mergeBtn'),
]);
const merged = readFileSync(await dl.path());
const pageCount = await page.evaluate(async (b64) => {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return (await PDFLib.PDFDocument.load(u)).getPageCount();
}, merged.toString('base64'));
ok(pageCount === 3, `폐쇄망에서 PDF 병합 동작 (1+2=${pageCount}쪽)`);

/* 3) 계산기·이미지 도구도 한 번씩 — 카테고리마다 외부 의존이 다를 수 있다 */
for (const slug of ['pdf-rotate', 'pdf-compress', 'img-to-pdf', 'about']) {
  const r = await page.goto(`${origin}/${slug}/`, { waitUntil: 'networkidle' });
  ok(r && r.status() === 200, `${slug} 로드 (${r && r.status()})`);
}

/* 4) ★핵심★ — 여기까지 오는 동안 외부로 나간 요청이 하나라도 있으면 상품 가치가 없다 */
const uniq = [...new Set(external)];
ok(uniq.length === 0, `외부 요청 0건 (실제 ${uniq.length}건)${uniq.length ? ' → ' + uniq.slice(0, 5).join(' , ') : ''}`);

/* 5) 번들 안에 수집·광고·백엔드 설정이 남아 있지 않은지 (코드 레벨 확인) */
const authCfg = readFileSync(join(ROOT, 'assets/auth-config.js'), 'utf8');
ok(!/MDTL_CONVEX|convex\.site|supabase/.test(authCfg), '수집·백엔드 설정 비어 있음');
const adsCfg = readFileSync(join(ROOT, 'assets/ads-config.js'), 'utf8');
ok(!/MDTL_ADS\s*=/.test(adsCfg), '광고 설정 비어 있음');
ok(!existsSync(join(ROOT, 'assets/vendor/convex.js')), 'Convex 클라이언트 미포함');
ok(!existsSync(join(ROOT, 'sitemap.xml')), '내부망 배포이므로 sitemap 없음');
const anyHtml = readFileSync(join(ROOT, 'pdf-merge/index.html'), 'utf8');
ok(/noindex/.test(anyHtml), '내부망 배포이므로 noindex');

ok(errs.length === 0, 'JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));

await browser.close();
server.close();
console.log(fails === 0 ? '\n자체호스팅 번들 전체 통과 — 외부 통신 0건 확인' : `\n실패 ${fails}건`);
process.exit(fails ? 1 : 0);
