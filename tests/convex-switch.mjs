/* Convex 백엔드 스위치 검증: MDTL_CONVEX.url 설정 시 텔레메트리가 /log-event로 가고
   Supabase로는 아무것도 안 나가는지 + 페이로드 형식이 동일한지 확인. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
const PREFIX = '/modutool';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || '/';
  if (p.endsWith('/')) p += 'index.html';
  const f = join(ROOT, p);
  try { if (statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return; } } catch (e) {}
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();

const convexPosts = [];
let supabasePosts = 0;
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.includes('/log-event')) {
    try { convexPosts.push(JSON.parse(route.request().postData() || '{}')); } catch (e) {}
    route.fulfill({ status: 201, body: '' });
    return;
  }
  if (url.includes('supabase.co')) { supabasePosts++; route.fulfill({ status: 201, body: '' }); return; }
  // auth-config.js를 Convex 활성 버전으로 바꿔치기
  if (url.endsWith('/assets/auth-config.js')) {
    const orig = readFileSync(join(ROOT, 'pdf/assets/auth-config.js'), 'utf8');
    route.fulfill({ status: 200, contentType: 'text/javascript',
      body: orig.replace('window.MDTL_CONVEX = null;', "window.MDTL_CONVEX = { url: 'https://fake-deploy.convex.site' };") });
    return;
  }
  route.continue();
});
await page.addInitScript(() => { try { localStorage.setItem('mdtl-tel-force', '1'); } catch (e) {} });
await page.goto(`${base}${PREFIX}/pdf/pdf-compress/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.mdtlLogEvent === 'function');
await page.evaluate(() => { window.mdtlLogEvent('pdf-compress', 'no_result', 'result_not_smaller', { pages: 3, size_bucket: '1-5MB' }); });
await page.waitForTimeout(400);
await browser.close(); server.close();

const fails = [];
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); }
ok(convexPosts.length >= 2, `Convex /log-event 수신 ${convexPosts.length}건 (pageview + no_result)`);
ok(supabasePosts === 0, 'Supabase로는 0건 (완전 전환)');
const nr = convexPosts.find((e) => e.outcome === 'no_result');
ok(!!nr && nr.tool === 'pdf-compress' && nr.meta && nr.meta.pages === 3, '페이로드 형식 동일(tool/outcome/meta)');
const pv = convexPosts.find((e) => e.outcome === 'view');
ok(!!pv, 'pageview도 Convex로 전송');
console.log('\n' + (fails.length ? `❌ ${fails.length} 실패` : '✅ 전부 통과'));
process.exit(fails.length ? 1 : 0);
