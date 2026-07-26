/* 이미지 도구 결과 검증 — 다운로드된 이미지를 실제로 디코드해 크기·포맷·픽셀을 확인한다.
   이미지 도구는 "뭔가 파일이 떨어지면" 성공처럼 보이지만, 크기가 안 바뀌었거나 회전이 반대이거나
   포맷만 확장자로 바뀐 경우를 화면으로는 못 잡는다. 그래서 바이트를 열어본다.

   포맷 판별은 확장자가 아니라 매직바이트로 한다(확장자만 바꾼 가짜 변환을 잡기 위해).
   크기·픽셀은 브라우저에서 createImageBitmap으로 디코드해 확인한다. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
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
const base = `http://127.0.0.1:${server.address().port}${PREFIX}/img`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

async function open(slug) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/${slug}/`, { waitUntil: 'networkidle' });
  return { page, errs };
}

/* 매직바이트로 실제 포맷 판별 — 확장자만 바꾼 '가짜 변환'을 잡는다 */
function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b.slice(1, 4).toString() === 'PNG') return 'png';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'webp';
  return 'unknown';
}

/* 좌상단이 빨강, 우상단이 파랑인 가로형 이미지 — 회전·반전 방향을 판별할 수 있게 비대칭으로 만든다 */
async function makeImage(page, w, h) {
  return page.evaluate(([W, H]) => new Promise((res) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff0000'; g.fillRect(0, 0, Math.floor(W / 2), Math.floor(H / 2));       // 좌상 빨강
    g.fillStyle = '#0000ff'; g.fillRect(Math.floor(W / 2), 0, Math.ceil(W / 2), Math.floor(H / 2)); // 우상 파랑
    c.toBlob((b) => {
      const r = new FileReader();
      r.onload = () => res(r.result.split(',')[1]);
      r.readAsDataURL(b);
    }, 'image/png');
  }), [w, h]);
}
const buf = (b64) => Buffer.from(b64, 'base64');

/* 디코드해서 크기 + 지정 좌표 픽셀색을 읽는다 */
async function decode(page, bytes, probes = []) {
  return page.evaluate(async ([b64, pts]) => {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u]));
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    const g = c.getContext('2d');
    const colors = pts.map(([fx, fy]) => {
      const x = Math.min(bmp.width - 1, Math.max(0, Math.round(fx * bmp.width)));
      const y = Math.min(bmp.height - 1, Math.max(0, Math.round(fy * bmp.height)));
      const d = g.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    return { w: bmp.width, h: bmp.height, colors };
  }, [bytes.toString('base64'), probes]);
}

async function grabDownload(page, action, timeout = 25000) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout }), action()]);
  const stream = await dl.createReadStream();
  return new Promise((res, rej) => {
    const c = [];
    stream.on('data', (d) => c.push(d));
    stream.on('end', () => res(Buffer.concat(c)));
    stream.on('error', rej);
  });
}
const near = (c, r, g, b, tol = 60) =>
  Math.abs(c[0] - r) < tol && Math.abs(c[1] - g) < tol && Math.abs(c[2] - b) < tol;

/* ── image-resize : 400x200 → 폭 100 (비율 유지 시 높이 50) ── */
{
  const { page, errs } = await open('image-resize');
  const src = await makeImage(page, 400, 200);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.png', mimeType: 'image/png', buffer: buf(src) }]);
  await page.waitForSelector('#convertBtn:not([disabled])', { timeout: 20000 });
  await page.fill('#widthInput', '100');
  await page.waitForTimeout(200);
  const out = await grabDownload(page, () => page.click('#convertBtn'));
  const d = await decode(page, out);
  ok(d.w === 100, `resize: 폭 100 (실제 ${d.w})`);
  ok(d.h === 50, `resize: 비율 유지로 높이 50 (실제 ${d.h})`);
  ok(errs.length === 0, 'image-resize JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── image-rotate : 오른쪽 90도 → 가로세로 뒤바뀜 + 좌상 빨강이 우상으로 이동 ── */
{
  const { page, errs } = await open('image-rotate');
  const src = await makeImage(page, 400, 200);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.png', mimeType: 'image/png', buffer: buf(src) }]);
  await page.waitForSelector('#convertBtn:not([disabled])', { timeout: 20000 });
  await page.click('#rotR');
  await page.waitForTimeout(300);
  const out = await grabDownload(page, () => page.click('#convertBtn'));
  // 90도 시계방향: 400x200 → 200x400, 원본 좌상(빨강)은 결과의 우상으로 간다
  const d = await decode(page, out, [[0.75, 0.15], [0.25, 0.15]]);
  ok(d.w === 200 && d.h === 400, `rotate: 90도 회전으로 400x200 → 200x400 (실제 ${d.w}x${d.h})`);
  ok(near(d.colors[0], 255, 0, 0), `rotate: 시계방향이므로 원본 좌상(빨강)이 우상으로 (실제 rgb(${d.colors[0]}))`);
  ok(near(d.colors[1], 255, 255, 255) || !near(d.colors[1], 255, 0, 0),
    `rotate: 좌상은 빨강이 아님 (실제 rgb(${d.colors[1]}))`);
  ok(errs.length === 0, 'image-rotate JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── image-convert : PNG → JPEG (매직바이트로 실제 변환 확인) ── */
{
  const { page, errs } = await open('image-convert');
  const src = await makeImage(page, 200, 200);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.png', mimeType: 'image/png', buffer: buf(src) }]);
  await page.waitForSelector('#goBtn:not([disabled])', { timeout: 20000 });
  await page.selectOption('#outFmt', 'jpeg');
  await page.click('#goBtn');
  // 결과는 #outList 안 li.file-item + 항목별 ⬇ 버튼(.mini)으로 나온다
  await page.waitForSelector('#outList .file-item .mini:not([disabled])', { timeout: 30000 });
  const out = await grabDownload(page, () => page.click('#outList .file-item .mini'));
  const fmt = sniff(out);
  ok(fmt === 'jpeg', `convert: PNG → JPEG 실제 변환 (매직바이트 판별: ${fmt})`);
  const d = await decode(page, out);
  ok(d.w === 200 && d.h === 200, `convert: 크기 보존 200x200 (실제 ${d.w}x${d.h})`);
  ok(errs.length === 0, 'image-convert JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── image-watermark : 워터마크가 실제로 픽셀을 바꾸는지 ── */
{
  const { page, errs } = await open('image-watermark');
  const src = await makeImage(page, 400, 300);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.png', mimeType: 'image/png', buffer: buf(src) }]);
  // 워터마크 문구가 비어 있으면 버튼이 계속 비활성이다(빈 워터마크를 찍지 않는 것 — 올바른 동작).
  // 그래서 파일 → 문구 → 활성화 순서를 지켜야 한다.
  await page.fill('#wmText', 'SAMPLE');
  await page.waitForSelector('#convertBtn:not([disabled])', { timeout: 20000 });
  await page.waitForTimeout(300);
  const out = await grabDownload(page, () => page.click('#convertBtn'));
  const d = await decode(page, out);
  ok(d.w === 400 && d.h === 300, `watermark: 크기 보존 400x300 (실제 ${d.w}x${d.h})`);
  // 워터마크가 들어갔으면 원본과 바이트가 달라야 한다(아무것도 안 그리고 재저장만 하는 경우 방지)
  const same = out.equals(buf(src));
  ok(!same, 'watermark: 결과가 원본과 다름(실제로 그려짐)');
  ok(errs.length === 0, 'image-watermark JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── image-crop : 1:1 비율로 자르면 정사각형이 나와야 한다 ── */
{
  const { page, errs } = await open('image-crop');
  const src = await makeImage(page, 400, 200);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.png', mimeType: 'image/png', buffer: buf(src) }]);
  await page.waitForSelector('#wrap', { state: 'visible', timeout: 20000 });
  await page.waitForTimeout(400);

  // 자를 영역은 드래그로 만들어야 한다. 비율 선택은 "이미 있는 선택"을 그 비율로 맞출 뿐이라
  // 드래그 없이 비율만 고르면 버튼이 계속 비활성이다(선택 없이 자르지 않는 것 — 올바른 동작).
  const box = await page.locator('#wrap').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.15);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.85, { steps: 12 });
  await page.mouse.up();
  await page.waitForSelector('#cropBtn:not([disabled])', { timeout: 20000 });

  await page.selectOption('#ratioSel', '1:1');
  await page.waitForTimeout(400);
  const out = await grabDownload(page, () => page.click('#cropBtn'));
  const d = await decode(page, out);
  ok(Math.abs(d.w - d.h) <= 2, `crop: 1:1 비율 → 정사각형 (실제 ${d.w}x${d.h})`);
  ok(d.w < 400, `crop: 원본보다 좁아짐 400 → ${d.w}`);
  ok(errs.length === 0, 'image-crop JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

await browser.close();
server.close();
console.log(fails === 0 ? '\n이미지 도구 전체 통과' : `\n실패 ${fails}건`);
process.exit(fails ? 1 : 0);
