/* 계산기 6종 결과 검증 — "페이지가 열린다"가 아니라 "숫자가 맞다"를 본다.
   계산기는 조용히 틀려도 아무도 모르는 종류의 도구라(오류 메시지가 안 뜬다),
   여기서 막지 못하면 사용자가 잘못된 값을 그대로 가져간다.
   기대값은 코드를 읽고 만든 게 아니라 손으로 계산한 값을 박아둔다(구현을 그대로 베끼면 검증이 아니다). */
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
const base = `http://127.0.0.1:${server.address().port}${PREFIX}/calc`;
const browser = await chromium.launch(launchOptions());

let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const num = (s) => Number(String(s).replace(/[^0-9.-]/g, ''));

async function open(slug) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/${slug}/`, { waitUntil: 'networkidle' });
  return { page, errs };
}

/* ── 만 나이 계산기 ──
   기준일을 고정해 오늘 날짜에 의존하지 않게 한다(날짜 테스트가 내일 깨지는 고전적 사고 방지). */
{
  const { page, errs } = await open('age-calculator');
  // 1990-05-15 생, 기준 2026-05-14 → 생일 하루 전이므로 만 35세
  await page.fill('#birth', '1990-05-15');
  await page.fill('#ref', '2026-05-14');
  await page.waitForTimeout(200);
  let t = await page.locator('#out').innerText();
  ok(/\b35\b/.test(t), `생일 하루 전 = 만 35세 (출력: ${t.replace(/\s+/g, ' ').slice(0, 70)})`);

  // 기준 2026-05-15 → 생일 당일이므로 만 36세
  await page.fill('#ref', '2026-05-15');
  await page.waitForTimeout(200);
  t = await page.locator('#out').innerText();
  ok(/\b36\b/.test(t), `생일 당일 = 만 36세 (출력: ${t.replace(/\s+/g, ' ').slice(0, 70)})`);

  // 윤년 2월 29일생 — 평년 기준일에서 깨지지 않아야 한다
  await page.fill('#birth', '2000-02-29');
  await page.fill('#ref', '2026-02-28');
  await page.waitForTimeout(200);
  t = await page.locator('#out').innerText();
  ok(/\b25\b/.test(t), `윤년생(2/29) 평년 2/28 기준 = 만 25세 (출력: ${t.replace(/\s+/g, ' ').slice(0, 70)})`);
  ok(errs.length === 0, 'age-calculator JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── 퍼센트 계산기 (4가지 모드) ──
   결과는 출력 div 안 .num 에 들어간다. innerText 전체를 읽으면 설명문의 숫자까지 섞이므로
   반드시 .num 만 본다(이걸 놓치면 테스트가 항상 통과해버려 검증 가치가 0이 된다). */
{
  const { page, errs } = await open('percent-calculator');
  const main = (id) => page.locator(`#${id} .num`).innerText();
  const cases = [
    // [입력A, 입력B, 출력, A값, B값, 기대값, 설명]
    ['c1a', 'c1b', 'c1out', '200', '15', 30, '200의 15% = 30'],
    ['c2a', 'c2b', 'c2out', '30', '200', 15, '30은 200의 15%'],
    ['c3a', 'c3b', 'c3out', '200', '250', 25, '200 → 250 = 25% 증가'],
    ['c4a', 'c4b', 'c4out', '50000', '20', 40000, '50,000원 20% 할인 = 40,000원'],
  ];
  for (const [a, b, out, va, vb, expect, label] of cases) {
    await page.fill('#' + a, va);
    await page.fill('#' + b, vb);
    await page.waitForTimeout(150);
    const txt = await main(out);
    const got = num(txt);
    ok(Math.abs(got - expect) < 0.01, `${label} (실제 "${txt}")`);
  }
  // 증가/감소 방향이 뒤집히지 않는지 (부호만 맞고 문구가 반대인 사고 방지)
  await page.fill('#c3a', '200'); await page.fill('#c3b', '250');
  await page.waitForTimeout(150);
  ok(/increase/i.test(await main('c3out')), '200→250 은 increase로 표기');
  await page.fill('#c3a', '250'); await page.fill('#c3b', '200');
  await page.waitForTimeout(150);
  const dec = await main('c3out');
  ok(/decrease/i.test(dec) && Math.abs(num(dec) - 20) < 0.01, `250→200 은 20% decrease (실제 "${dec}")`);
  // 0으로 나누기 방어
  await page.fill('#c3a', '0'); await page.fill('#c3b', '100');
  await page.waitForTimeout(150);
  ok(/cannot|불가|undefined/i.test(await main('c3out')), '기준값 0이면 계산 불가 안내(0으로 나누기 방어)');
  ok(errs.length === 0, 'percent-calculator JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── D-day 계산기 ── */
{
  const { page, errs } = await open('dday-calculator');
  // 날짜 사이 간격: 2026-01-01 ~ 2026-03-01 = 59일 (1월 31 + 2월 28)
  await page.fill('#gapStart', '2026-01-01');
  await page.fill('#gapEnd', '2026-03-01');
  await page.waitForTimeout(200);
  let t = await page.locator('#gapOut').innerText();
  ok(/\b59\b/.test(t), `2026-01-01→03-01 = 59일 (출력: ${t.replace(/\s+/g, ' ').slice(0, 60)})`);

  // 날짜 더하기: 2026-01-01 + 30일 = 2026-01-31
  await page.fill('#adBase', '2026-01-01');
  await page.fill('#adDays', '30');
  await page.waitForTimeout(200);
  t = await page.locator('#adOut').innerText();
  // 페이지 언어가 영문이라 'January 31, 2026' 형식으로 나온다
  ok(/January 31, 2026|2026-01-31|1월 31/.test(t), `2026-01-01 +30일 = 01-31 (출력: ${t.replace(/\s+/g, ' ').slice(0, 60)})`);
  ok(errs.length === 0, 'dday-calculator JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── 삼각함수 계산기 ── */
{
  const { page, errs } = await open('trig-calculator');
  await page.fill('#angleIn', '30');
  await page.waitForTimeout(200);
  let t = await page.locator('#trigOut').innerText();
  ok(/0\.5/.test(t), `sin30° = 0.5 포함 (출력: ${t.replace(/\s+/g, ' ').slice(0, 90)})`);

  // 직각삼각형: 3-4-? → 빗변 5 (피타고라스)
  await page.fill('#triA', '3');
  await page.fill('#triB', '4');
  await page.waitForTimeout(250);
  t = await page.locator('#triOut').innerText();
  ok(/\b5\b/.test(t), `3-4 직각삼각형 빗변 = 5 (출력: ${t.replace(/\s+/g, ' ').slice(0, 90)})`);
  ok(errs.length === 0, 'trig-calculator JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── 평수 계산기 — 1평 = 3.305785㎡ ── */
{
  const { page, errs } = await open('pyeong-calculator');
  await page.fill('#pyIn', '10');
  await page.waitForTimeout(200);
  let t = await page.locator('#convOut').innerText();
  ok(/33\.0[0-9]|33\.1/.test(t), `10평 ≈ 33.06㎡ (출력: ${t.replace(/\s+/g, ' ').slice(0, 80)})`);

  await page.fill('#pyIn', '');
  await page.fill('#m2In', '33.06');
  await page.waitForTimeout(200);
  t = await page.locator('#convOut').innerText();
  ok(/\b10\b|9\.9/.test(t), `33.06㎡ ≈ 10평 (출력: ${t.replace(/\s+/g, ' ').slice(0, 80)})`);

  // 가로x세로 → 면적: 3m × 4m = 12㎡ ≈ 3.63평
  await page.fill('#wIn', '3');
  await page.fill('#hIn', '4');
  await page.waitForTimeout(200);
  t = await page.locator('#areaOut').innerText();
  ok(/\b12\b/.test(t) && /3\.6/.test(t), `3m×4m = 12㎡ ≈ 3.63평 (출력: ${t.replace(/\s+/g, ' ').slice(0, 80)})`);
  ok(errs.length === 0, 'pyeong-calculator JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

/* ── 글자수 세기 — 공백/줄바꿈/단어/바이트 ── */
{
  const { page, errs } = await open('char-count');
  // "가나 다라\nab c" → 가·나·공백·다·라·개행·a·b·공백·c = 10자
  //   공백 제외(공백+개행 제거) = 가나다라abc = 7자
  await page.fill('#txt', '가나 다라\nab c');
  await page.waitForTimeout(250);
  const g = async (id) => num(await page.locator('#' + id).innerText());
  ok(await g('cntAll') === 10, `전체 글자수 10 (실제 ${await g('cntAll')})`);
  ok(await g('cntNoSpace') === 7, `공백·개행 제외 7 (실제 ${await g('cntNoSpace')})`);
  ok(await g('cntLines') === 2, `줄 수 2 (실제 ${await g('cntLines')})`);
  ok(await g('cntWords') === 4, `단어 수 4 (실제 ${await g('cntWords')})`);
  // UTF-8: 한글 4자×3 + 공백1 + \n1 + 'ab c' 4 = 18바이트
  ok(await g('cntUtf8') === 18, `UTF-8 바이트 18 (실제 ${await g('cntUtf8')})`);
  // EUC-KR: 한글 4자×2 + 나머지 ASCII 6 = 14바이트
  ok(await g('cntEuc') === 14, `EUC-KR 바이트 14 (실제 ${await g('cntEuc')})`);
  ok(errs.length === 0, 'char-count JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await page.close();
}

await browser.close();
server.close();
console.log(fails === 0 ? '\n계산기 6종 전체 통과' : `\n실패 ${fails}건`);
process.exit(fails ? 1 : 0);
