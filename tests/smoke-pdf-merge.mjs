/* pdf-merge 스모크: 실제 PDF 2개 업로드 → 병합 → 다운로드 파일 페이지수 검증
   사용: node tests/smoke-pdf-merge.mjs <baseURL> [fixtureDir(pdf-lib 설치된 곳) — 생략 시 _pw.mjs 탐색 순서] */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadChromium, launchOptions } from './_pw.mjs';

const base = process.argv[2] || 'http://localhost:8931';
if (process.argv[3]) process.env.PW_DIR = process.argv[3];
const chromium = loadChromium();
const pdfLibDir = process.argv[3] || dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(pdfLibDir, 'package.json'));
const { PDFDocument } = require('pdf-lib');

/* 픽스처는 테스트가 직접 만든다 — 사전 준비된 파일에 의존하면 환경마다 깨진다(밀폐형). */
const fixDir = mkdtempSync(join(tmpdir(), 'mdtl-smoke-'));
async function makePdf(pages) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}
writeFileSync(join(fixDir, 'fixture-a.pdf'), await makePdf(1));
writeFileSync(join(fixDir, 'fixture-b.pdf'), await makePdf(2));

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// 1) 허브
await page.goto(base + '/', { waitUntil: 'networkidle' });
const tiles = await page.locator('.tool-tile').count();
if (tiles < 10) throw new Error('허브 타일 부족: ' + tiles);

// 2) pdf-merge 병합 플로우 (현행 UI: #grid의 .pdf-card 썸네일 + ◀▶ 이동 버튼)
await page.goto(base + '/pdf-merge/', { waitUntil: 'networkidle' });
await page.setInputFiles('#dz input[type=file]', [join(fixDir, 'fixture-a.pdf'), join(fixDir, 'fixture-b.pdf')]);
// 파일 파싱·카드 렌더는 비동기 — 도달할 때까지 대기 후 판정
await page.waitForFunction(() => document.querySelectorAll('.pdf-card').length === 2, { timeout: 10000 })
  .catch(() => { throw new Error('파일 카드 2개 아님'); });

// 순서 바꾸기(b를 앞으로) 후 병합 — ◀▶은 터치 폴백이라 데스크톱에선 숨겨져 있어 이벤트를 직접 발화
await page.locator('.pdf-card').nth(1).locator('.mv button').first().dispatchEvent('click');
const firstName = await page.locator('.pdf-card .fn').first().textContent();
if (!firstName.includes('fixture-b')) throw new Error('순서변경 실패: ' + firstName);

const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }),
  page.click('#mergeBtn'),
]);
const outPath = join(fixDir, 'merged-out.pdf');
await download.saveAs(outPath);
const merged = await PDFDocument.load(readFileSync(outPath));
if (merged.getPageCount() !== 3) throw new Error('병합 페이지수 오류: ' + merged.getPageCount());
const resultText = await page.locator('#result').textContent();
if (!/Done|완료/.test(resultText)) throw new Error('결과 문구 오류: ' + resultText);

if (errors.length) throw new Error('JS 오류: ' + errors.join(' | '));
console.log('✅ smoke ok — 허브 타일 ' + tiles + '개, 병합 3쪽, JS 오류 0');
await browser.close();
