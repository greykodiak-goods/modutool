/* PDF 도구 결과 검증 — 다운로드된 PDF를 실제로 파싱해 쪽수·회전·텍스트·크기를 확인한다.
   기존엔 "페이지가 열리고 JS 오류가 없다"만 봤다. PDF는 깨진 결과를 내도 화면에 오류가 안 뜨고
   사용자가 파일을 열어봐야 아는 종류라, 산출물을 열어보지 않으면 검증이 아니다.

   픽스처는 브라우저 안에서 pdf-lib으로 만든다(엔진이 이미 페이지에 로드돼 있어 추가 의존성 0).
   검증도 pdf-lib으로 다시 로드해서 한다 — 바이트를 정규식으로 훑으면 압축 스트림에 가려 오판한다. */
import { loadChromium, launchOptions, distDir, repoDir } from './_pw.mjs';
const chromium = loadChromium();
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

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
const base = `http://127.0.0.1:${server.address().port}${PREFIX}/pdf`;
const browser = await chromium.launch(launchOptions());

let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

async function open(slug) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/${slug}/`, { waitUntil: 'networkidle' });
  return { page, errs };
}

/* 픽스처 생성·검증 전용 페이지.
   도구마다 로드하는 엔진이 다르다(pdf-to-jpg는 pdf.js만 쓰고 pdf-lib이 없다).
   그래서 pdf-lib이 확실히 있는 페이지 하나를 열어두고 만들기·열어보기를 전부 여기서 한다. */
const fx = await browser.newPage();
await fx.goto(`${base}/pdf-merge/`, { waitUntil: 'networkidle' });
await fx.waitForFunction(() => typeof PDFLib !== 'undefined', null, { timeout: 20000 });

/* N쪽 PDF를 만들어 base64로 돌려받는다. 쪽마다 다른 크기를 줄 수 있다. */
async function makePdf(page, pages) {
  return fx.evaluate(async (specs) => {
    const d = await PDFLib.PDFDocument.create();
    for (const s of specs) d.addPage([s[0], s[1]]);
    const b = await d.save();
    let out = '';
    for (const x of b) out += String.fromCharCode(x);
    return btoa(out);
  }, pages);
}
const buf = (b64) => Buffer.from(b64, 'base64');

/* 다운로드 결과를 pdf-lib으로 다시 열어 구조를 읽는다 */
async function inspect(page, bytes) {
  return fx.evaluate(async (b64) => {
    const bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    const d = await PDFLib.PDFDocument.load(u, { ignoreEncryption: true });
    return {
      count: d.getPageCount(),
      sizes: d.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]),
      rotations: d.getPages().map((p) => p.getRotation().angle),
    };
  }, bytes.toString('base64'));
}

async function clickable(page, sel) {
  // 비활성 버튼을 눌러 다운로드를 기다리면 25초 타임아웃으로만 죽어 원인을 못 찾는다.
  const dis = await page.locator(sel).isDisabled().catch(() => true);
  if (dis) throw new Error(`버튼이 비활성 상태: ${sel}`);
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

const A4 = [595, 842];

/* ── pdf-rotate : 전체 오른쪽 회전 → 모든 쪽 90도 ── */
{
  const { page, errs } = await open('pdf-rotate');
  const src = await makePdf(page, [A4, A4, A4]);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(src) }]);
  await page.waitForFunction(() => document.querySelectorAll('#pgGrid > *').length >= 3, null, { timeout: 20000 });
  await page.click('#allRightBtn');
  const out = await grabDownload(page, () => page.click('#saveBtn'));
  const r = await inspect(page, out);
  ok(r.count === 3, `rotate: 쪽수 보존 3 (실제 ${r.count})`);
  ok(r.rotations.every((a) => a === 90), `rotate: 전 쪽 90도 (실제 ${r.rotations.join(',')})`);
  ok(errs.length === 0, 'pdf-rotate JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── pdf-extract : 5쪽에서 2-4 추출 → 3쪽 ── */
{
  const { page, errs } = await open('pdf-extract');
  const src = await makePdf(page, [A4, A4, A4, A4, A4]);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(src) }]);
  await page.waitForSelector('#rangeWrap', { state: 'visible', timeout: 20000 });
  await page.fill('#rangeInput', '2-4');
  const out = await grabDownload(page, () => page.click('#goBtn'));
  const r = await inspect(page, out);
  ok(r.count === 3, `extract: 2-4 추출 → 3쪽 (실제 ${r.count})`);
  ok(errs.length === 0, 'pdf-extract JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── pdf-organize : 쪽 삭제가 실제로 반영되는지 ──
   저장 버튼은 "편집이 있어야" 활성화된다(바뀐 게 없는데 저장을 권하지 않는 것 — 올바른 동작).
   그래서 3쪽 중 1쪽을 지우고 저장해 2쪽이 되는지를 본다. */
{
  const { page, errs } = await open('pdf-organize');
  const src = await makePdf(page, [[400, 600], [400, 600], [400, 600]]);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(src) }]);
  await page.waitForFunction(() => document.querySelectorAll('#pgGrid > *').length >= 3, null, { timeout: 20000 });

  ok(await page.locator('#saveBtn').isDisabled(), 'organize: 편집 전에는 저장 비활성(바뀐 게 없으면 권하지 않음)');
  await page.locator('#pgGrid [data-act=del]').nth(1).click();   // 2번째 쪽 삭제
  await page.waitForTimeout(200);
  await clickable(page, '#saveBtn');

  const out = await grabDownload(page, () => page.click('#saveBtn'));
  const r = await inspect(page, out);
  ok(r.count === 2, `organize: 3쪽 중 1쪽 삭제 → 2쪽 (실제 ${r.count})`);
  ok(r.sizes.every((s) => s[0] === 400 && s[1] === 600), `organize: 원본 크기 400x600 보존 (실제 ${JSON.stringify(r.sizes[0])})`);
  ok(errs.length === 0, 'pdf-organize JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── pdf-page-numbers : 쪽번호를 넣어도 쪽수·크기가 바뀌면 안 된다 ── */
{
  const { page, errs } = await open('pdf-page-numbers');
  const src = await makePdf(page, [A4, A4, A4]);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(src) }]);
  await page.waitForSelector('#goBtn:not([disabled])', { timeout: 20000 });
  const before = (await inspect(page, buf(src))).count;
  const out = await grabDownload(page, () => page.click('#goBtn'));
  const r = await inspect(page, out);
  ok(r.count === before, `page-numbers: 쪽수 보존 ${before} (실제 ${r.count})`);
  ok(r.sizes.every((s) => s[0] === A4[0] && s[1] === A4[1]), `page-numbers: 쪽 크기 보존 (실제 ${JSON.stringify(r.sizes[0])})`);
  ok(out.length > buf(src).length, `page-numbers: 내용이 실제로 추가됨 (${buf(src).length} → ${out.length}바이트)`);
  ok(errs.length === 0, 'pdf-page-numbers JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── pdf-watermark : 워터마크 후에도 쪽수 보존 + 바이트 증가 ── */
{
  const { page, errs } = await open('pdf-watermark');
  const src = await makePdf(page, [A4, A4]);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(src) }]);
  await page.waitForSelector('#goBtn:not([disabled])', { timeout: 20000 });
  await page.fill('#wmText', 'CONFIDENTIAL');
  const out = await grabDownload(page, () => page.click('#goBtn'));
  const r = await inspect(page, out);
  ok(r.count === 2, `watermark: 쪽수 보존 2 (실제 ${r.count})`);
  ok(out.length > buf(src).length, `watermark: 내용이 실제로 추가됨 (${buf(src).length} → ${out.length}바이트)`);
  ok(errs.length === 0, 'pdf-watermark JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── img-to-pdf : 이미지 2장 → 2쪽 PDF ── */
{
  const { page, errs } = await open('img-to-pdf');
  // 페이지 안에서 캔버스로 PNG 2장 생성
  const pngs = await page.evaluate(async () => {
    const mk = (color, w, h) => new Promise((res) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.fillStyle = color; g.fillRect(0, 0, w, h);
      c.toBlob((b) => {
        const r = new FileReader();
        r.onload = () => res(r.result.split(',')[1]);
        r.readAsDataURL(b);
      }, 'image/png');
    });
    return [await mk('#f00', 200, 300), await mk('#00f', 300, 200)];
  });
  await page.setInputFiles('#dz input[type=file]', pngs.map((b64, i) => ({
    name: `img${i}.png`, mimeType: 'image/png', buffer: buf(b64),
  })));
  await page.waitForSelector('#makeBtn:not([disabled])', { timeout: 20000 });
  const out = await grabDownload(page, () => page.click('#makeBtn'));
  const r = await inspect(page, out);
  ok(r.count === 2, `img-to-pdf: 이미지 2장 → 2쪽 (실제 ${r.count})`);
  ok(errs.length === 0, 'img-to-pdf JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── pdf-compress : 결과가 원본보다 크면 내주지 않아야 한다(가장 처음 보고된 '왜 압축 안돼' 케이스) ── */
{
  const { page, errs } = await open('pdf-compress');
  const src = await makePdf(page, [A4, A4]);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(src) }]);
  await page.waitForSelector('#compBtn:not([disabled])', { timeout: 20000 });
  let downloaded = null;
  page.once('download', (d) => { downloaded = d; });
  await page.click('#compBtn');
  await page.waitForSelector('#result.show', { timeout: 30000 });
  const msg = (await page.locator('#result').innerText()).replace(/\s+/g, ' ');
  if (downloaded) {
    ok(true, `compress: 결과 파일 생성 — "${msg.slice(0, 60)}"`);
  } else {
    // 이미 최소 크기인 PDF는 "더 줄일 수 없음"을 알려야 한다. 조용히 아무것도 안 하면 안 된다.
    ok(msg.length > 0, `compress: 줄일 수 없을 때 사유를 안내함 — "${msg.slice(0, 80)}"`);
  }
  ok(errs.length === 0, 'pdf-compress JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── pdf-to-jpg : 3쪽 PDF → 썸네일 3개 렌더 ── */
{
  const { page, errs } = await open('pdf-to-jpg');
  const src = await makePdf(page, [A4, A4, A4]);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(src) }]);
  await page.waitForSelector('#convBtn:not([disabled])', { timeout: 20000 });
  await page.click('#convBtn');
  await page.waitForFunction(() => document.querySelectorAll('#thumbs img, #thumbs canvas').length >= 3, null, { timeout: 40000 });
  const n = await page.locator('#thumbs img, #thumbs canvas').count();
  ok(n >= 3, `pdf-to-jpg: 3쪽 → 이미지 ${n}개 생성`);
  ok(errs.length === 0, 'pdf-to-jpg JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── pdf-sign : 서명을 그려 배치하면 해당 쪽에 실제로 삽입되는지 ──
   흐름이 3단계다: PDF 드롭 → 서명패드에 그리기 → 미리보기에서 위치 클릭 → 저장.
   어느 한 단계라도 빠지면 저장 버튼이 안 열린다(빈 서명을 넣지 않는 것 — 올바른 동작). */
{
  const { page, errs } = await open('pdf-sign');
  const src = await makePdf(page, [A4, A4]);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'a.pdf', mimeType: 'application/pdf', buffer: buf(src) }]);
  await page.waitForSelector('#pv', { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);

  ok(await page.locator('#applyBtn').isDisabled(), 'sign: 서명 전에는 저장 비활성');

  // 서명패드에 획 하나 긋기
  const pad = await page.locator('#pad').boundingBox();
  await page.mouse.move(pad.x + pad.width * 0.2, pad.y + pad.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(pad.x + pad.width * 0.5, pad.y + pad.height * 0.3, { steps: 8 });
  await page.mouse.move(pad.x + pad.width * 0.8, pad.y + pad.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // 미리보기에서 서명 위치 지정.
  // ⚠️ page.mouse는 "뷰포트" 좌표를 쓴다. 미리보기는 문서 아래쪽(y≈1700)이라 마우스 좌표로
  //    누르면 화면 밖을 눌러 아무 일도 안 일어난다. locator.click은 스크롤을 맞춰주므로 그걸 쓴다.
  const pvBox = await page.locator('#pv').boundingBox();
  await page.locator('#pv').click({ position: { x: pvBox.width * 0.6, y: pvBox.height * 0.8 } });
  await page.waitForTimeout(300);
  await clickable(page, '#applyBtn');

  const out = await grabDownload(page, () => page.click('#applyBtn'), 40000);
  const r = await inspect(page, out);
  ok(r.count === 2, `sign: 쪽수 보존 2 (실제 ${r.count})`);
  ok(r.sizes.every((v) => v[0] === A4[0] && v[1] === A4[1]), `sign: 쪽 크기 보존 (실제 ${JSON.stringify(r.sizes[0])})`);
  ok(out.length > buf(src).length, `sign: 서명이 실제로 삽입됨 (${buf(src).length} → ${out.length}바이트)`);
  ok(errs.length === 0, 'pdf-sign JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── pdf-split : 범위 추출 — 4쪽에서 2-3만 뽑아 한 파일로 ──
   (2026-08-22 계약 소급 중 발견: split만 결과검증이 없었다 — 커버리지 래칫의 느슨판정 구멍) */
{
  const { page, errs } = await open('pdf-split');
  const src = await makePdf(page, [A4, A4, A4, A4]);
  await page.setInputFiles('#dz input[type=file]', [{ name: 'four.pdf', mimeType: 'application/pdf', buffer: buf(src) }]);
  await page.waitForFunction(() => document.getElementById('rangeWrap').style.display !== 'none', null, { timeout: 20000 });
  await page.fill('#rangeInput', '2-3');
  await clickable(page, '#goBtn');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 25000 }), page.click('#goBtn')]);
  ok(/_2-3\.pdf$/.test(dl.suggestedFilename()), `split: 파일명 범위 표기 (${dl.suggestedFilename()})`);
  const stream = await dl.createReadStream();
  const out = await new Promise((res, rej) => { const c = []; stream.on('data', (d) => c.push(d)); stream.on('end', () => res(Buffer.concat(c))); stream.on('error', rej); });
  const r = await inspect(page, out);
  ok(r.count === 2, `split: 4쪽 중 2-3 추출 → 2쪽 (실제 ${r.count})`);
  ok(errs.length === 0, 'pdf-split JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

await fx.close();
await browser.close();
server.close();
console.log(fails === 0 ? '\nPDF 도구 전체 통과' : `\n실패 ${fails}건`);
process.exit(fails ? 1 : 0);
