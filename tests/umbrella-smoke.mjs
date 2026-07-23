/* 우산 구조(/=포털, /pdf /img /calc) + 신규 툴 기능 스모크. dist를 /modutool 프리픽스로 마운트해 검증. */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
const PREFIX = '/modutool';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

async function visit(url, fn) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  const missing = [];
  page.on('response', (r) => { if (r.status() === 404) missing.push(r.url()); });
  await page.goto(base + url, { waitUntil: 'networkidle' });
  try { await fn(page); } catch (e) { ok(false, url + ' → ' + e.message); }
  ok(errs.length === 0 && missing.length === 0, url + ' 무오류·404없음' + (errs.length ? ' JSERR:' + errs[0] : '') + (missing.length ? ' 404:' + missing[0] : ''));
  await page.close();
}

// 포털
await visit('/', async (p) => {
  const brands = await p.evaluate(() => document.body.textContent);
  ok(/ThisIsMyPDF/.test(brands) && /ThisIsMyIMG/.test(brands) && /ThisIsMyCalculator/.test(brands), '/ 포털 3브랜드 노출');
  const tiles = await p.locator('.tile').count();
  ok(tiles >= 33, `/ 포털 타일 ${tiles}개(≥33)`);
});
await visit('/ko/', async (p) => {
  ok(/모든 도구/.test(await p.evaluate(() => document.body.textContent)), '/ko/ 한글 포털');
});

// 서브사이트 허브
await visit('/pdf/', async (p) => {
  const t = await p.evaluate(() => document.querySelector('#site-header .logo').textContent);
  ok(/ThisIsMyPDF/.test(t), '/pdf/ 브랜드');
  const hasImage = await p.evaluate(() => !!document.getElementById('image'));
  ok(!hasImage, '/pdf/ 허브에 이미지 섹션 없음');
});
await visit('/img/', async (p) => {
  ok(/ThisIsMyIMG/.test(await p.evaluate(() => document.querySelector('#site-header .logo').textContent)), '/img/ 브랜드');
});
await visit('/calc/', async (p) => {
  const hasUtil = await p.evaluate(() => !!document.getElementById('util'));
  ok(hasUtil, '/calc/ 허브에 유틸 섹션 있음');
});

// 신규 툴 기능 스팟체크
await visit('/calc/vat-calculator/', async (p) => {
  await p.fill('input[type="number"], input[inputmode="numeric"], #amount', '10000').catch(async () => {
    const first = p.locator('input').first(); await first.fill('10000');
  });
  await p.waitForTimeout(250);
  const text = await p.evaluate(() => document.body.textContent);
  ok(/11,000/.test(text), 'VAT: 10,000 → 합계 11,000 표시');
});
await visit('/calc/qr-generator/', async (p) => {
  await p.fill('textarea', 'https://example.com').catch(async () => { await p.locator('textarea').first().fill('https://example.com'); });
  await p.waitForTimeout(500);
  const drawn = await p.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c || !c.width) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++;
    return dark > 50;
  });
  ok(drawn, 'QR: 캔버스에 실제 모듈 렌더됨');
});
await visit('/calc/password-generator/', async (p) => {
  const v = await p.evaluate(() => { const i = document.querySelector('input[readonly]'); return i ? i.value : ''; });
  ok(v.length >= 8, `비밀번호 자동생성됨 (길이 ${v.length})`);
});
await visit('/calc/text-diff/', async (p) => {
  const tas = p.locator('textarea');
  await tas.nth(0).fill('hello world');
  await tas.nth(1).fill('hello brave world');
  await p.waitForTimeout(700);
  const hasIns = await p.evaluate(() => document.querySelectorAll('ins').length > 0);
  ok(hasIns, 'diff: 추가분 <ins> 하이라이트');
});
await visit('/calc/unit-converter/', async (p) => {
  const text = await p.evaluate(() => document.body.textContent);
  ok(text.length > 100, '단위 변환기 로드');
});
await visit('/img/image-exif/', async (p) => {
  ok(await p.evaluate(() => typeof window.mdtlDropzone === 'function'), 'EXIF: 헬퍼 로드');
});
await visit('/img/image-redact/', async (p) => {
  ok(await p.evaluate(() => typeof window.mdtlLogEvent === 'function'), '블라인드: 텔레메트리 로드');
});
await visit('/img/image-split/', async (p) => {});
await visit('/img/image-color-picker/', async (p) => {});
await visit('/calc/interest-calculator/', async (p) => {});

// 리다이렉트 스텁 — 절대주소(실배포 오리진)라 로컬에선 내용으로 검증(항해 검증은 live-check가 실URL로 수행)
{
  const html = readFileSync(join(ROOT, 'pdf-merge/index.html'), 'utf8');
  ok(/http-equiv="refresh"[^>]*url=[^"]*\/pdf\/pdf-merge\//.test(html) && /rel="canonical"[^>]*\/pdf\/pdf-merge\//.test(html) && /noindex/.test(html),
    '구 /pdf-merge/ 스텁: refresh+canonical→/pdf/pdf-merge/ + noindex');
  const koHtml = readFileSync(join(ROOT, 'ko/image-compress/index.html'), 'utf8');
  ok(/url=[^"]*\/img\/ko\/image-compress\//.test(koHtml), '구 /ko/image-compress/ 스텁 → /img/ko/…');
}

await browser.close(); server.close();
console.log('\n' + (fails ? `❌ ${fails} 실패` : '✅ 전부 통과'));
process.exit(fails ? 1 : 0);
