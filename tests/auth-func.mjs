/* 회원 기능(Convex Auth 이관) 기능 테스트.
   컨테이너에서 convex.dev로 못 나가므로 Convex HTTP API를 page.route로 가로채 흉내낸다.
   검증 대상은 "우리가 쓴 글루 코드" — 토큰 저장/갱신, OAuth 코드 교환, 로그아웃, 화면 분기.
   (비밀번호 해싱·세션 발급 자체는 라이브러리 몫이라 여기서 검증하지 않는다.) */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = new URL('../dist', import.meta.url).pathname;
const PREFIX = '/modutool';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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

/* 만료시각을 심은 가짜 JWT (서명은 검증되지 않는 경로라 아무 값이나 둔다) */
function jwt(expSeconds) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'RS256' }) + '.' + b64({ exp: Math.floor(Date.now() / 1000) + expSeconds }) + '.sig';
}

/* Convex 백엔드 흉내. calls 배열에 (경로, 함수명, args, Authorization)을 기록한다. */
async function mockConvex(ctx, handlers, calls) {
  await ctx.route('**/api/{action,query,mutation}', async (route) => {
    const req = route.request();
    const body = JSON.parse(req.postData() || '{}');
    const name = body.path || '';
    // Convex HTTP 프로토콜은 args를 배열로 보낸다: {"path":"f","args":[{...}]}
    const args = (Array.isArray(body.args) ? body.args[0] : body.args) || {};
    calls.push({ name, args, auth: req.headers()['authorization'] || null });
    const h = handlers[name];
    if (!h) { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'error', errorMessage: 'no handler: ' + name }) }); return; }
    const out = h(args);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(out && out.__error
        ? { status: 'error', errorMessage: out.__error }
        : { status: 'success', value: out }),
    });
  });
}

async function newCtx(handlers, calls, storage) {
  const ctx = await browser.newContext();
  if (storage) {
    // addInitScript는 "모든" 문서 로드에서 실행되므로, 그대로 두면 로그아웃 뒤 이동한 페이지에서
    // 토큰이 되살아나 정리 여부를 검증할 수 없다. 최초 1회만 심는다.
    await ctx.addInitScript((s) => {
      try {
        if (localStorage.getItem('__seeded')) return;
        localStorage.setItem('__seeded', '1');
        for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
      } catch (e) {}
    }, storage);
  }
  await mockConvex(ctx, handlers, calls);
  return ctx;
}

const ME = { email: 'a@b.com', name: null, plan: 'free', planExpiresAt: null, isAdmin: false, createdAt: 1 };

/* ── 1) 비밀번호 로그인: 토큰이 저장되고 계정 페이지로 이동 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'auth:signIn': () => ({ tokens: { token: jwt(3600), refreshToken: 'RT-1' } }),
    'account:me': () => ME,
    'account:ensureProfile': () => ({ created: true, plan: 'free' }),
  }, calls);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '/pdf/login/', { waitUntil: 'networkidle' });
  ok(await page.locator('#loginForm').isVisible(), '로그인 폼 노출(백엔드 설정됨)');
  await page.fill('#email', 'A@B.com');
  await page.fill('#password', 'passw0rd');
  await Promise.all([page.waitForURL(/\/pdf\/account\//), page.click('#loginForm button[type=submit]')]);
  ok(true, '로그인 성공 → 계정 페이지로 이동');

  const signIn = calls.find((c) => c.name === 'auth:signIn');
  ok(signIn && signIn.args.params.email === 'a@b.com', `이메일 소문자 정규화 (${signIn && signIn.args.params.email})`);
  ok(signIn && signIn.args.params.flow === 'signIn', 'flow=signIn 전달');

  const stored = await page.evaluate(() => ({
    jwt: !!localStorage.getItem('mdtl-auth-jwt'),
    rt: localStorage.getItem('mdtl-auth-refresh'),
  }));
  ok(stored.jwt && stored.rt === 'RT-1', '액세스·리프레시 토큰 저장됨');
  ok(await page.locator('#emailLabel').textContent() === 'a@b.com', '계정 페이지에 이메일 표시');

  const authed = calls.filter((c) => c.name === 'account:me' && c.auth);
  ok(authed.length > 0, 'account:me 호출에 Authorization 헤더가 붙음');
  ok(errs.length === 0, 'JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await ctx.close();
}

/* ── 2) 로그인 실패: 계정 존재 여부를 드러내지 않는 단일 문구 ── */
{
  const calls = [];
  const ctx = await newCtx({ 'auth:signIn': () => ({ __error: 'InvalidSecret' }) }, calls);
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/login/', { waitUntil: 'networkidle' });
  await page.fill('#email', 'a@b.com');
  await page.fill('#password', 'wrongpass1');
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('#msg.show', { timeout: 5000 }).catch(() => {});
  const text = await page.locator('#msg').textContent();
  ok(/Incorrect email or password/.test(text), `실패 문구 = ${text.trim()}`);
  ok(!/InvalidSecret/.test(text), '서버 내부 사유가 노출되지 않음');
  ok(await page.evaluate(() => !localStorage.getItem('mdtl-auth-refresh')), '실패 시 토큰 미저장');
  ok(!page.url().includes('/account/'), '실패 시 이동하지 않음');
  await ctx.close();
}

/* ── 3) 회원가입 비밀번호 정책은 서버 왕복 전에 클라이언트가 먼저 안내 ── */
{
  const calls = [];
  const ctx = await newCtx({ 'auth:signIn': () => ({ tokens: { token: jwt(3600), refreshToken: 'RT-2' } }) }, calls);
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/signup/', { waitUntil: 'networkidle' });
  await page.fill('#email', 'a@b.com');
  await page.check('#agree');

  // 8자 미만은 input[minlength]로 브라우저가 제출 자체를 막는다(우리 문구까지 갈 일이 없다).
  await page.fill('#password', 'short1');
  await page.click('#signupForm button[type=submit]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !document.getElementById('password').validity.valid),
    '8자 미만은 브라우저 기본 검증이 차단');

  // 길이는 통과하지만 숫자가 없는 경우 → 우리 정책 문구
  await page.fill('#password', 'alllettersonly');
  await page.click('#signupForm button[type=submit]');
  await page.waitForTimeout(150);
  const t = await page.locator('#msg').textContent();
  ok(/letters and numbers/.test(t), `영문만 → ${t.trim()}`);
  ok(calls.filter((c) => c.name === 'auth:signIn').length === 0, '정책 위반은 서버를 호출하지 않음');
  await ctx.close();
}

/* ── 4) 만료된 액세스 토큰은 리프레시 토큰으로 자동 교환 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'auth:signIn': (a) => (a.refreshToken === 'RT-OLD'
      ? { tokens: { token: jwt(3600), refreshToken: 'RT-NEW' } }
      : { __error: 'unexpected' }),
    'account:me': () => ME,
    'account:ensureProfile': () => ({ created: false, plan: 'free' }),
  }, calls, { 'mdtl-auth-jwt': jwt(-60), 'mdtl-auth-refresh': 'RT-OLD' });
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/account/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#panel', { state: 'visible', timeout: 8000 });
  ok(true, '만료 토큰 상태로도 계정 페이지 진입');
  const refreshCalls = calls.filter((c) => c.name === 'auth:signIn' && c.args.refreshToken);
  ok(refreshCalls.length === 1, `갱신 호출 1회로 합쳐짐 (실제 ${refreshCalls.length}회)`);
  ok(await page.evaluate(() => localStorage.getItem('mdtl-auth-refresh')) === 'RT-NEW', '회전된 리프레시 토큰 저장');
  await ctx.close();
}

/* ── 5) 리프레시 실패(만료·재사용) → 세션 폐기 후 로그인 화면 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'auth:signIn': () => ({ __error: 'InvalidRefreshToken' }),
    'account:me': () => null,
    'account:ensureProfile': () => ({ __error: 'not_authenticated' }),
  }, calls, { 'mdtl-auth-jwt': jwt(-60), 'mdtl-auth-refresh': 'RT-DEAD' });
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/account/', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/pdf\/login\//, { timeout: 8000 });
  ok(true, '갱신 실패 시 로그인 페이지로 회수');
  ok(await page.evaluate(() => !localStorage.getItem('mdtl-auth-refresh')), '죽은 리프레시 토큰 폐기됨');
  await ctx.close();
}

/* ── 6) 구글 OAuth: verifier 보관 → 복귀 시 code 교환 + 주소창 정리 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'auth:signIn': (a) => {
      if (a.provider === 'google') return { redirect: base + '/pdf/login/?code=CODE-1', verifier: 'V-1' };
      if (a.params && a.params.code) return a.verifier === 'V-1'
        ? { tokens: { token: jwt(3600), refreshToken: 'RT-G' } }
        : { __error: 'bad verifier' };
      return { __error: 'unexpected' };
    },
    'account:me': () => ME,
    'account:ensureProfile': () => ({ created: true, plan: 'free' }),
  }, calls);
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/login/', { waitUntil: 'networkidle' });
  await page.click('#googleBtn');
  await page.waitForURL(/\/pdf\/account\//, { timeout: 10000 });
  ok(true, '구글 흐름: 인가 리다이렉트 → code 교환 → 계정 페이지');
  ok(await page.evaluate(() => localStorage.getItem('mdtl-auth-refresh')) === 'RT-G', '구글 로그인 토큰 저장');
  ok(await page.evaluate(() => !localStorage.getItem('mdtl-auth-verifier')), 'verifier는 사용 후 삭제됨');
  ok(!page.url().includes('code='), '주소창에서 1회용 code 제거됨');
  const redirectTo = calls.find((c) => c.args && c.args.provider === 'google').args.params.redirectTo;
  ok(redirectTo.endsWith('/modutool/pdf/login/'), `redirectTo = ${redirectTo}`);
  await ctx.close();
}

/* ── 7) 로그아웃 / 모든 기기 로그아웃 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'account:me': () => ME,
    'account:ensureProfile': () => ({ created: false, plan: 'free' }),
    'auth:signOut': () => null,
    'account:signOutEverywhere': () => ({ ok: true }),
  }, calls, { 'mdtl-auth-jwt': jwt(3600), 'mdtl-auth-refresh': 'RT-3' });
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/account/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#panel', { state: 'visible' });
  await page.click('#logoutAllBtn');
  await page.waitForURL((u) => !u.pathname.includes('/account/'), { timeout: 8000 });
  ok(calls.some((c) => c.name === 'account:signOutEverywhere'), '전체 로그아웃이 서버 세션 무효화를 호출');
  ok(calls.some((c) => c.name === 'auth:signOut'), '이 기기 세션도 종료');
  const left = await page.evaluate(() => ['mdtl-auth-jwt', 'mdtl-auth-refresh', 'mdtl-plan']
    .filter((k) => localStorage.getItem(k) !== null));
  ok(left.length === 0, `로컬 토큰·플랜 캐시 정리됨 (남은 키: ${left.join(', ') || '없음'})`);
  await ctx.close();
}

/* ── 8) 계정 삭제: 이메일이 일치해야만 호출된다 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'account:me': () => ME,
    'account:ensureProfile': () => ({ created: false, plan: 'free' }),
    'account:deleteAccount': () => ({ ok: true }),
    'auth:signOut': () => null,
  }, calls, { 'mdtl-auth-jwt': jwt(3600), 'mdtl-auth-refresh': 'RT-4' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/pdf/account/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#panel', { state: 'visible' });
  await page.locator('details').click();               // 접힌 영역 펼치기

  await page.fill('#delEmail', 'someone-else@x.com');
  await page.click('#delBtn');
  await page.waitForTimeout(200);
  ok(!calls.some((c) => c.name === 'account:deleteAccount'), '이메일 불일치면 삭제를 호출하지 않음');
  ok(/does not match/.test(await page.locator('#msg').textContent()), '불일치 안내 표시');

  await page.fill('#delEmail', 'a@b.com');
  await page.click('#delBtn');
  await page.waitForURL((u) => !u.pathname.includes('/account/'), { timeout: 8000 });
  const del = calls.find((c) => c.name === 'account:deleteAccount');
  ok(del && del.args.confirmEmail === 'a@b.com', '일치 시에만 삭제 호출');
  await ctx.close();
}

/* ── 9) 백오피스: 로그인 안 했으면 대시보드를 부르지 않고 로그인으로 보낸다 ── */
{
  const calls = [];
  const ctx = await newCtx({ 'dashboard:dashboard': () => ({ __error: 'not authorized' }) }, calls);
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/admin/', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/login\//, { timeout: 8000 });
  ok(calls.length === 0, '미로그인 상태에서 대시보드 쿼리를 호출하지 않음');
  await ctx.close();
}

/* ── 10) 백오피스: 로그인했지만 관리자가 아니면 거부 화면 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'dashboard:dashboard': () => ({ __error: 'not authorized' }),
  }, calls, { 'mdtl-auth-jwt': jwt(3600), 'mdtl-auth-refresh': 'RT-5' });
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/admin/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#denied', { state: 'visible', timeout: 8000 });
  const t = await page.locator('#denied').textContent();
  ok(/관리자로 등록되어 있지 않습니다/.test(t), '관리자 아님 안내 표시');
  ok(!/not authorized/.test(t), '서버 원문 메시지가 노출되지 않음');
  await ctx.close();
}

/* ── 11) Supabase 흔적이 남아있지 않은지 ── */
{
  const ctx = await newCtx({}, []);
  const page = await ctx.newPage();
  const hits = [];
  page.on('request', (r) => { if (/supabase/.test(r.url())) hits.push(r.url()); });
  await page.goto(base + '/pdf/login/', { waitUntil: 'networkidle' });
  const src = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).join(' '));
  ok(hits.length === 0, `supabase 요청 0건 (실제 ${hits.length})`);
  ok(!/supabase/.test(src), 'supabase 벤더 스크립트 미참조');
  ok(await page.evaluate(() => typeof window.MDTL_AUTH), '전역 MDTL_AUTH 제거됨 (undefined)');
  await ctx.close();
}

/* ── 12) 한국어 페이지도 같은 흐름으로 동작 (문구·이동 경로만 다름) ── */
{
  const calls = [];
  const ctx = await newCtx({
    'auth:signIn': () => ({ tokens: { token: jwt(3600), refreshToken: 'RT-KO' } }),
    'account:me': () => ME,
    'account:ensureProfile': () => ({ created: false, plan: 'free' }),
  }, calls);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '/pdf/ko/login/', { waitUntil: 'networkidle' });
  await page.fill('#email', 'a@b.com');
  await page.fill('#password', 'passw0rd');
  await Promise.all([page.waitForURL(/\/pdf\/ko\/account\//), page.click('#loginForm button[type=submit]')]);
  ok(true, '[ko] 로그인 → /ko/account/ 로 이동');
  await page.waitForSelector('#panel', { state: 'visible' });
  ok(await page.locator('#planLabel').textContent() === '무료', '[ko] 플랜 라벨 한국어');
  ok(await page.locator('#delBtn').count() === 1, '[ko] 회원 탈퇴 버튼 존재');
  ok(errs.length === 0, '[ko] JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await ctx.close();
}

await browser.close();
server.close();
console.log(fails === 0 ? '\n회원 기능 전체 통과' : `\n실패 ${fails}건`);
process.exit(fails ? 1 : 0);
