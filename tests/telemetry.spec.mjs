/* 텔레메트리 검증: 전역 자동 캡처가 발동하고, 페이로드에 파일명/파일내용이 절대 없는지 확인.
   실행: node tests/telemetry.spec.mjs  (dist를 로컬 서버로 띄우고 Chromium으로 확인) */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadChromium, launchOptions, distDir, repoDir } from './_pw.mjs';
const chromium = loadChromium();

const ROOT = distDir();
const PREFIX = '/modutool';   // 우산 빌드는 BASE_PATH=/modutool 기준
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || '/';
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

const fails = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); }

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();

// 텔레메트리 POST를 가로채 페이로드 수집(실제 전송은 막음)
const posted = [];
/* 수집 경로는 Supabase RPC tim_log_event 단일 경로다(2026-08-22 재이관 —
   옛 Convex /log-event를 가로채면 아무것도 안 잡혀 테스트가 무의미해진다).
   페이로드는 {p: row}로 감싸져 온다 — row 만 꺼내 기존 검증을 그대로 적용한다. */
await page.route('**/rest/v1/rpc/tim_log_event', (route) => {
  const req = route.request();
  try { posted.push(JSON.parse(req.postData() || '{}').p || {}); } catch (e) { posted.push({ _raw: req.postData() }); }
  route.fulfill({ status: 204, body: '' });
});

// 로컬에서도 텔레메트리 켜기(검증용 플래그)
await page.addInitScript(() => { try { localStorage.setItem('mdtl-tel-force', '1'); } catch (e) {} });

await page.goto(`${base}${PREFIX}/pdf/pdf-compress/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.mdtlLogEvent === 'function' && typeof window.mdtlResult === 'function');

// 1) 민감 파일명이 담긴 에러 메시지를 표시 → 전역 자동 캡처가 error 이벤트를 보내야 함
const SECRET = 'MERGER_ACQUISITION_2026_어닝계약.pdf';
await page.evaluate((secret) => {
  const el = document.getElementById('result');
  // 실제 툴이 에러 메시지에 파일명을 넣는 최악의 경우를 모사
  window.mdtlResult(el, '❌ Cannot open ' + secret + ' — this file is not a valid PDF.', true);
}, SECRET);

// 2) no_result / success 명시 계측 페이로드도 확인
await page.evaluate(() => {
  window.mdtlLogEvent('pdf-compress', 'no_result', 'result_not_smaller', { pages: 16, size_bucket: '5-10MB', level: 'balanced', filename: 'LEAK.pdf', note: 'should_be_dropped' });
});

await page.waitForTimeout(300);

// 3) 유입 귀속(utm): 화이트리스트 4종만 남고, 그 외 쿼리(gclid·검색어 등)는 절대 안 실린다
await page.goto(`${base}${PREFIX}/pdf/pdf-compress/?utm_source=yt&utm_campaign=pdftip&gclid=SHOULD_DROP&q=SECRET_QUERY`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);

await browser.close();
server.close();

// ── 검증 ──
check(posted.length >= 2, `이벤트 2건 이상 전송됨 (실제 ${posted.length})`);

const errEvt = posted.find((e) => e.outcome === 'error');
check(!!errEvt, 'error 이벤트가 자동 캡처됨');
check(errEvt && errEvt.tool === 'pdf-compress', 'tool 슬러그가 URL에서 유추됨 (pdf-compress)');
check(errEvt && errEvt.reason === 'invalid_file', `사유가 코드로 분류됨 (invalid_file, 실제 ${errEvt && errEvt.reason})`);

const noRes = posted.find((e) => e.outcome === 'no_result');
check(!!noRes, 'no_result 명시 이벤트 전송됨');
check(noRes && noRes.meta && noRes.meta.pages === 16 && noRes.meta.size_bucket === '5-10MB', '화이트리스트 메타(pages·size_bucket) 유지됨');
check(noRes && noRes.meta && noRes.meta.filename === undefined && noRes.meta.note === undefined, '비화이트리스트 메타(filename·note) 제거됨');

// ★ 핵심 프라이버시 검증: 어떤 페이로드에도 민감 파일명/조각이 절대 없어야 함
const blob = JSON.stringify(posted);
check(blob.indexOf(SECRET) === -1, '민감 파일명 전체가 페이로드에 없음');
check(blob.indexOf('어닝계약') === -1, '파일명 조각(한글)이 페이로드에 없음');
check(blob.indexOf('MERGER_ACQUISITION') === -1, '파일명 조각(영문)이 페이로드에 없음');
check(blob.indexOf('LEAK.pdf') === -1, 'meta로 넣은 파일명이 제거됨');

const utmView = posted.find((e) => e.outcome === 'view' && e.meta && e.meta.utm_source);
check(!!utmView, 'utm 붙은 방문이 view 이벤트로 수집됨');
check(utmView && utmView.meta.utm_source === 'yt' && utmView.meta.utm_campaign === 'pdftip', 'utm_source·utm_campaign 유지됨');
check(blob.indexOf('SHOULD_DROP') === -1, '비화이트리스트 쿼리(gclid)가 페이로드에 없음');
check(blob.indexOf('SECRET_QUERY') === -1, '검색어 쿼리가 페이로드에 없음');

console.log('\n' + (fails.length ? `❌ 실패 ${fails.length}건` : '✅ 전부 통과'));
process.exit(fails.length ? 1 : 0);
