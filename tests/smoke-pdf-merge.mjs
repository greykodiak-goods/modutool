/* pdf-merge 스모크: 실제 PDF 2개 업로드 → 병합 → 다운로드 파일 페이지수 검증
   사용: node tests/smoke-pdf-merge.mjs <baseURL> <fixtureDir(pdf-lib 설치된 곳)> */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:8931';
const fixDir = process.argv[3];
const require = createRequire(join(fixDir, 'package.json'));
const { chromium } = require('playwright');
const { PDFDocument } = require('pdf-lib');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// 1) 허브
await page.goto(base + '/', { waitUntil: 'networkidle' });
const tiles = await page.locator('.tool-tile').count();
if (tiles < 10) throw new Error('허브 타일 부족: ' + tiles);

// 2) pdf-merge 병합 플로우
await page.goto(base + '/pdf-merge/', { waitUntil: 'networkidle' });
await page.setInputFiles('#dz input[type=file]', [join(fixDir, 'fixture-a.pdf'), join(fixDir, 'fixture-b.pdf')]);
if ((await page.locator('.file-item').count()) !== 2) throw new Error('파일 목록 2개 아님');

// 순서 바꾸기(b를 위로) 후 병합
await page.locator('.file-item').nth(1).locator('[data-act=up]').click();
const firstName = await page.locator('.file-item .name').first().textContent();
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
if (!resultText.includes('완료')) throw new Error('결과 문구 오류: ' + resultText);

if (errors.length) throw new Error('JS 오류: ' + errors.join(' | '));
console.log('✅ smoke ok — 허브 타일 ' + tiles + '개, 병합 3쪽, JS 오류 0');
await browser.close();
