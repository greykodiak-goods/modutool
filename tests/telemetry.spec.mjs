/* 텔레메트리 검증: 전역 자동 캡처가 발동하고, 페이로드에 파일명/파일내용이 절대 없는지 확인.
   실행: node tests/telemetry.spec.mjs  (dist를 로컬 서버로 띄우고 Chromium으로 확인) */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;

const ROOT = new URL('../dist', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();

// 텔레메트리 POST를 가로채 페이로드 수집(실제 전송은 막음)
const posted = [];
await page.route('**/rest/v1/tool_events', (route) => {
  const req = route.request();
  try { posted.push(JSON.parse(req.postData() || '{}')); } catch (e) { posted.push({ _raw: req.postData() }); }
  route.fulfill({ status: 201, body: '' });
});

// 로컬에서도 텔레메트리 켜기(검증용 플래그)
await page.addInitScript(() => { try { localStorage.setItem('mdtl-tel-force', '1'); } catch (e) {} });

await page.goto(`${base}/pdf-compress/`, { waitUntil: 'domcontentloaded' });
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

console.log('\n' + (fails.length ? `❌ 실패 ${fails.length}건` : '✅ 전부 통과'));
process.exit(fails.length ? 1 : 0);
