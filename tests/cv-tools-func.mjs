/* 배경 제거 + 물체 제거 기능 검증 (실브라우저 + 실제 opencv.js 엔진).
   bg-remove: 파란 배경 + 빨간 사각형 → rect 드래그 → 출력 모서리 투명·중앙 불투명 확인.
   object-remove: 흰 배경 + 검은 사각형 → 브러시 → 인페인팅 후 해당 영역이 밝아졌는지 확인. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;   // 소스 트리 서빙(/assets/vendor/opencv.js 로드)
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

const fails = [];
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); }

async function inject(page, drawFn, name) {
  await page.evaluate(async ([fnSrc, fname]) => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200;
    (new Function('ctx', 'c', fnSrc))(c.getContext('2d'), c);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], fname, { type: 'image/png' });
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('dz').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  }, [drawFn, name]);
}
function drag(page, targetSel, x1, y1, x2, y2) {
  return page.evaluate(([sel, a, b, c, d]) => {
    const tgt = document.querySelector(sel);
    const refCv = tgt.tagName === 'CANVAS' ? tgt : tgt.querySelector('canvas');
    const r = refCv.getBoundingClientRect();
    const o = (X, Y) => ({ bubbles: true, clientX: r.left + X, clientY: r.top + Y, pointerId: 1 });
    tgt.dispatchEvent(new PointerEvent('pointerdown', o(a, b)));
    for (let i = 1; i <= 8; i++) tgt.dispatchEvent(new PointerEvent('pointermove', o(a + (c - a) * i / 8, b + (d - b) * i / 8)));
    tgt.dispatchEvent(new PointerEvent('pointerup', o(c, d)));
  }, [targetSel, x1, y1, x2, y2]);
}
async function readPng(page, path) {
  const b64 = readFileSync(path).toString('base64');
  return page.evaluate(async (b) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + b; });
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const at = (X, Y) => Array.from(x.getImageData(X, Y, 1, 1).data);
    return { w: img.width, h: img.height, corner: at(4, 4), center: at(Math.round(img.width / 2), Math.round(img.height / 2)) };
  }, b64);
}

// ── 1) 배경 제거 ──
{
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/image-bg-remove/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.mdtlDropzone === 'function');
  // 파랑 배경 + 중앙 빨간 사각형
  await inject(page, "ctx.fillStyle='#1040ee';ctx.fillRect(0,0,300,200);ctx.fillStyle='#ee2020';ctx.fillRect(100,60,100,80);", 'subject.png');
  await page.waitForSelector('.bg-stage.show');
  await page.waitForFunction(() => document.getElementById('result').textContent.indexOf('engine') === -1 || !document.getElementById('result').className.includes('show'), null, { timeout: 120000 });
  // rect: 피사체(100,60~200,140 → preview 좌표 동일 배율: workW=300, preview=300) 여유 포함
  await drag(page, '#wrap', 85, 45, 215, 155);
  await page.waitForFunction(() => !document.getElementById('saveBtn').disabled, null, { timeout: 120000 });
  ok(true, 'bg-remove: grabCut 실행 완료(다운로드 활성)');
  const dl = page.waitForEvent('download');
  await page.click('#saveBtn');
  const download = await dl;
  ok(/_no-bg\.png$/.test(download.suggestedFilename()), 'bg-remove: 파일명 _no-bg.png');
  const px = await readPng(page, await download.path());
  ok(px.w === 300 && px.h === 200, `bg-remove: 원본 해상도 유지 (${px.w}x${px.h})`);
  ok(px.corner[3] < 40, `bg-remove: 모서리(배경) 투명 (alpha=${px.corner[3]})`);
  ok(px.center[3] > 200 && px.center[0] > 150, `bg-remove: 중앙(피사체) 유지 (alpha=${px.center[3]}, r=${px.center[0]})`);
  ok(errs.length === 0, 'bg-remove: JS 오류 없음' + (errs.length ? ': ' + errs[0] : ''));
  await page.close();
}

// ── 2) 물체 제거 ──
{
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/image-object-remove/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.mdtlDropzone === 'function');
  // 흰 배경 + 중앙 검은 사각형(지울 대상)
  await inject(page, "ctx.fillStyle='#f5f5f0';ctx.fillRect(0,0,300,200);ctx.fillStyle='#101010';ctx.fillRect(130,80,40,40);", 'photo.png');
  await page.waitForSelector('.or-stage.show');
  // 브러시로 사각형 덮기 (여러 스트로크)
  await drag(page, '.or-wrap canvas.paint', 125, 100, 180, 100);
  await drag(page, '.or-wrap canvas.paint', 125, 85, 180, 85);
  await drag(page, '.or-wrap canvas.paint', 125, 115, 180, 115);
  await page.waitForFunction(() => !document.getElementById('applyBtn').disabled);
  await page.click('#applyBtn');
  await page.waitForFunction(() => !document.getElementById('saveBtn').disabled, null, { timeout: 120000 });
  ok(true, 'object-remove: 인페인팅 실행 완료');
  const dl = page.waitForEvent('download');
  await page.click('#saveBtn');
  const download = await dl;
  ok(/_cleaned\.png$/.test(download.suggestedFilename()), 'object-remove: 파일명 _cleaned.png');
  const px = await readPng(page, await download.path());
  ok(px.center[0] > 150 && px.center[1] > 150, `object-remove: 검은 사각형이 주변색으로 채워짐 (rgb=${px.center.slice(0, 3)})`);
  ok(px.corner[0] > 200, 'object-remove: 비브러시 영역 원본 유지');
  ok(errs.length === 0, 'object-remove: JS 오류 없음' + (errs.length ? ': ' + errs[0] : ''));
  await page.close();
}

await browser.close(); server.close();
console.log('\n' + (fails.length ? `❌ ${fails.length} 실패` : '✅ 전부 통과'));
process.exit(fails.length ? 1 : 0);
