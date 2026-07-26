/* 문의 폼 검증 — 사이트에 "연락할 방법"이 실제로 동작하는지.
   About 페이지가 "문의 이메일로 보내달라"고 하면서 사이트 어디에도 이메일이 없던 상태를 고친 것이라,
   여기서 검증할 것은 "폼이 예쁘다"가 아니라 "메시지가 서버로 실제로 나간다"이다.

   Convex는 컨테이너에서 못 나가므로 /contact 엔드포인트를 가로채 요청 본문을 확인한다. */
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
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

/* /contact 를 가로채 본문을 기록. status로 서버 응답을 바꿔 실패 경로도 확인한다. */
async function newCtx(status = 201) {
  const posts = [];
  const ctx = await browser.newContext();
  await ctx.route('**/contact', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    posts.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({ status, contentType: 'text/plain', body: '' });
  });
  return { ctx, posts };
}

/* ── 1) 정상 전송 ── */
{
  const { ctx, posts } = await newCtx(201);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/pdf/contact/`, { waitUntil: 'networkidle' });

  await page.fill('#subject', 'Compress made my file bigger');
  await page.fill('#body', 'I uploaded a 2MB PDF and it said the result was not smaller.');
  await page.fill('#email', 'Someone@Example.COM');
  await page.click('#contactForm button[type=submit]');
  await page.waitForSelector('#msg.show', { timeout: 8000 });

  ok(posts.length === 1, `전송 1건 발생 (실제 ${posts.length})`);
  const p0 = posts[0] || {};
  ok(p0.subject === 'Compress made my file bigger', `제목 전달 (${p0.subject})`);
  ok(/not smaller/.test(p0.body || ''), '본문 전달');
  ok(p0.email === 'Someone@Example.COM', '이메일 전달(정규화는 서버 몫)');
  ok(p0.hp === '', '허니팟은 빈 값으로 전송(사람)');
  ok(p0.lang === 'en' && p0.site === 'pdf', `언어·브랜드 태깅 (${p0.lang}/${p0.site})`);

  const t = await page.locator('#msg').innerText();
  ok(/Sent|thank you/i.test(t), `성공 안내 표시 — "${t.trim().slice(0, 50)}"`);
  ok(await page.inputValue('#subject') === '', '전송 후 폼 초기화(같은 내용 중복 전송 방지)');
  ok(errs.length === 0, 'JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await ctx.close();
}

/* ── 2) 필수값이 비면 브라우저가 먼저 막는다(서버 왕복 없음) ── */
{
  const { ctx, posts } = await newCtx(201);
  const page = await ctx.newPage();
  await page.goto(`${base}/pdf/contact/`, { waitUntil: 'networkidle' });
  await page.click('#contactForm button[type=submit]');
  await page.waitForTimeout(300);
  ok(posts.length === 0, '제목·내용이 비면 전송하지 않음');
  ok(await page.evaluate(() => !document.getElementById('subject').validity.valid), '필수 입력 표시가 동작');
  await ctx.close();
}

/* ── 3) 상한 초과(429)는 "잠시 후 다시"로 안내해야 한다 — 실패를 성공처럼 보이면 안 된다 ── */
{
  const { ctx } = await newCtx(429);
  const page = await ctx.newPage();
  await page.goto(`${base}/pdf/contact/`, { waitUntil: 'networkidle' });
  await page.fill('#subject', 'x'); await page.fill('#body', 'y');
  await page.click('#contactForm button[type=submit]');
  await page.waitForSelector('#msg.show', { timeout: 8000 });
  const t = await page.locator('#msg').innerText();
  ok(/minute|again/i.test(t), `429 → 재시도 안내 — "${t.trim().slice(0, 60)}"`);
  ok(await page.locator('#msg').getAttribute('class').then((c) => c.includes('error')), '429는 오류 스타일로 표시');
  await ctx.close();
}

/* ── 4) 서버 거절(400)도 성공처럼 보이면 안 된다 ── */
{
  const { ctx } = await newCtx(400);
  const page = await ctx.newPage();
  await page.goto(`${base}/pdf/contact/`, { waitUntil: 'networkidle' });
  await page.fill('#subject', 'x'); await page.fill('#body', 'y');
  await page.click('#contactForm button[type=submit]');
  await page.waitForSelector('#msg.show', { timeout: 8000 });
  const t = await page.locator('#msg').innerText();
  ok(/Could not send/i.test(t), `400 → 실패 안내 — "${t.trim().slice(0, 60)}"`);
  ok(await page.inputValue('#subject') === 'x', '실패 시 입력 내용을 지우지 않음(다시 쓰게 만들지 않는다)');
  await ctx.close();
}

/* ── 5) 한국어 페이지 ── */
{
  const { ctx, posts } = await newCtx(201);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(`${base}/pdf/ko/contact/`, { waitUntil: 'networkidle' });
  await page.fill('#subject', '제목');
  await page.fill('#body', '내용입니다');
  await page.click('#contactForm button[type=submit]');
  await page.waitForSelector('#msg.show', { timeout: 8000 });
  ok((posts[0] || {}).lang === 'ko', `[ko] 언어 태깅 (${(posts[0] || {}).lang})`);
  ok(/보냈습니다/.test(await page.locator('#msg').innerText()), '[ko] 성공 안내 한국어');
  ok(errs.length === 0, '[ko] JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await ctx.close();
}

/* ── 6) 발견 가능성 — 푸터에서 닿을 수 있어야 연락 수단이다 ── */
{
  const { ctx } = await newCtx();
  const page = await ctx.newPage();
  await page.goto(`${base}/pdf/pdf-merge/`, { waitUntil: 'networkidle' });
  const href = await page.locator('#site-footer a[href$="/contact/"]').first().getAttribute('href');
  ok(!!href, `도구 페이지 푸터에 문의 링크 (${href})`);
  await page.goto(`${base}/pdf/about/`, { waitUntil: 'networkidle' });
  const inAbout = await page.locator('main a[href$="/contact/"]').count();
  ok(inAbout > 0, 'About 본문의 "메시지 보내기"가 실제 링크 (이전엔 없는 이메일을 안내했다)');
  await ctx.close();
}

await browser.close();
server.close();
console.log(fails === 0 ? '\n문의 폼 전체 통과' : `\n실패 ${fails}건`);
process.exit(fails ? 1 : 0);
