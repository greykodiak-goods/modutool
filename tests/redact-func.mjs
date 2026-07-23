/* image-redact 기능 검증: 이미지 로드 → 드래그로 2개 영역(모자이크+검정) → 다운로드 →
   출력 픽셀이 영역 안에서만 바뀌었는지 확인. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;   // 소스 트리 직접 서빙(원본 경로 __ORIGIN__은 페이지 로직과 무관)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`${base}/image-redact/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.mdtlDropzone === 'function');

const fails = [];
function check(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); }

// 1) 테스트 이미지(200x100, 좌=빨강 우=파랑) 주입
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 200; c.height = 100;
  const x = c.getContext('2d');
  x.fillStyle = '#ff0000'; x.fillRect(0, 0, 100, 100);
  x.fillStyle = '#0000ff'; x.fillRect(100, 0, 100, 100);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'secret_account.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  const dz = document.getElementById('dz');
  dz.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
});
await page.waitForSelector('.redact-stage.show');
check(true, '이미지 로드 → 스테이지 표시');

// 2) 드래그로 영역 2개 (모자이크: 좌상단 / 검정: 우측)
async function dragRegion(x1, y1, x2, y2) {
  await page.evaluate(([a, b, c, d]) => {
    const wrap = document.getElementById('wrap');
    const cv = document.getElementById('preview');
    const r = cv.getBoundingClientRect();
    const opts = (X, Y) => ({ bubbles: true, clientX: r.left + X, clientY: r.top + Y, pointerId: 1 });
    wrap.dispatchEvent(new PointerEvent('pointerdown', opts(a, b)));
    wrap.dispatchEvent(new PointerEvent('pointermove', opts((a + c) / 2, (b + d) / 2)));
    wrap.dispatchEvent(new PointerEvent('pointermove', opts(c, d)));
    wrap.dispatchEvent(new PointerEvent('pointerup', opts(c, d)));
  }, [x1, y1, x2, y2]);
}
await dragRegion(10, 10, 60, 40);                       // 모자이크 (기본 모드)
await page.selectOption('#modeSel', 'black');
await dragRegion(120, 20, 180, 80);                     // 검정
const saveEnabled = await page.evaluate(() => !document.getElementById('saveBtn').disabled);
check(saveEnabled, '영역 2개 추가 → 다운로드 버튼 활성화');

// 3) 다운로드 가로채 픽셀 검증
const dl = page.waitForEvent('download');
await page.click('#saveBtn');
const download = await dl;
const path = await download.path();
check(/_masked\.png$/.test(download.suggestedFilename()), '파일명 _masked.png (원본 이름 유지)');

// 저장된 PNG를 다시 브라우저 캔버스로 읽어 픽셀 확인
const png = readFileSync(path).toString('base64');
const px = await page.evaluate(async (b64) => {
  const img = new Image();
  await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const at = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data);
  return { w: img.width, h: img.height, black: at(150, 50), redKept: at(10, 90), blueKept: at(105, 5) };
}, png);
check(px.w === 200 && px.h === 100, `원본 해상도 유지 (${px.w}x${px.h})`);
check(px.black[0] < 10 && px.black[1] < 10 && px.black[2] < 10, `검정 영역 실제로 검정 (${px.black.slice(0,3)})`);
check(px.redKept[0] > 200 && px.redKept[2] < 50, '영역 밖(좌하단 빨강) 원본 유지');
check(px.blueKept[2] > 200 && px.blueKept[0] < 50, '영역 밖(우상단 파랑) 원본 유지');
check(errs.length === 0, '페이지 JS 오류 없음' + (errs.length ? ': ' + errs.join('|') : ''));

await browser.close(); server.close();
console.log('\n' + (fails.length ? `❌ ${fails.length} 실패` : '✅ 전부 통과'));
process.exit(fails.length ? 1 : 0);
