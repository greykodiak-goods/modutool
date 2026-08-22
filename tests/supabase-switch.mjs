/* Supabase 백엔드 스위치 검증(2026-08-22 재이관): 텔레메트리가 rpc/tim_log_event 로만 가고
   구 Convex(.convex.site/.convex.cloud)로는 아무것도 안 나가는지 + 페이로드 계약({p: row}) 확인. */
import { loadChromium, launchOptions, distDir, repoDir } from './_pw.mjs';
const chromium = loadChromium();
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = distDir();
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
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();

const rpcPosts = [];
let convexHits = 0;
let apikeySeen = false;
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.includes('/rest/v1/rpc/tim_log_event')) {
    try { rpcPosts.push(JSON.parse(route.request().postData() || '{}')); } catch (e) {}
    if (route.request().headers()['apikey']) apikeySeen = true;
    route.fulfill({ status: 204, body: '' });
    return;
  }
  if (url.includes('.convex.site') || url.includes('.convex.cloud')) { convexHits++; route.fulfill({ status: 404, body: '' }); return; }
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
const rows = rpcPosts.map((b) => b.p).filter(Boolean);
ok(rows.length >= 2, `rpc/tim_log_event 수신 ${rows.length}건 (pageview + no_result)`);
ok(rpcPosts.every((b) => b && typeof b.p === 'object'), '페이로드가 {p: row} 계약을 지킴');
ok(apikeySeen, 'apikey 헤더 동봉');
ok(convexHits === 0, `구 Convex로는 0건 (실제 ${convexHits})`);
const nr = rows.find((e) => e.outcome === 'no_result');
ok(!!nr && nr.tool === 'pdf-compress' && nr.meta && nr.meta.pages === 3, '페이로드 형식 유지(tool/outcome/meta)');
const pv = rows.find((e) => e.outcome === 'view');
ok(!!pv, 'pageview도 Supabase로 전송');
console.log('\n' + (fails.length ? `❌ ${fails.length} 실패` : '✅ 전부 통과'));
process.exit(fails.length ? 1 : 0);
