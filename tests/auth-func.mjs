/* 회원 기능(Supabase Auth 재이관) 기능 테스트.
   컨테이너에서 supabase.co로 못 나가므로 GoTrue/PostgREST를 page.route로 가로채 흉내낸다.
   검증 대상은 "우리가 쓴 글루 코드" — 토큰 저장/갱신, PKCE 코드 교환, 로그아웃, 화면 분기,
   Convex 함수명→tim_ RPC 번역(RPC_MAP). (비밀번호 해싱·세션 발급 자체는 Supabase 몫이라 검증하지 않는다.) */
import { loadChromium, launchOptions, distDir, repoDir } from './_pw.mjs';
const chromium = loadChromium();
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = distDir();
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
const browser = await chromium.launch(launchOptions());

let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

/* 만료시각을 심은 가짜 JWT (서명은 검증되지 않는 경로라 아무 값이나 둔다) */
function jwt(expSeconds) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'RS256' }) + '.' + b64({ exp: Math.floor(Date.now() / 1000) + expSeconds }) + '.sig';
}
const session = (rt) => ({ access_token: jwt(3600), refresh_token: rt, token_type: 'bearer', expires_in: 3600 });

/* Supabase 백엔드 흉내. calls 배열에 (이름, 본문, Authorization, url)을 기록한다.
   핸들러 반환 규약: {__error, __status} = 에러 응답, {__redirect} = 302, null/undefined = 204. */
async function mockSupabase(ctx, handlers, calls) {
  await ctx.route('**/auth/v1/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    let name;
    if (u.pathname.endsWith('/token')) name = 'token:' + u.searchParams.get('grant_type');
    else if (u.pathname.endsWith('/signup')) name = 'signup';
    else if (u.pathname.endsWith('/logout')) name = 'logout' + (u.searchParams.get('scope') === 'global' ? ':global' : '');
    else if (u.pathname.endsWith('/authorize')) name = 'authorize';
    else name = u.pathname;
    calls.push({ name, args: body, auth: req.headers()['authorization'] || null, url: req.url() });
    const h = handlers[name];
    if (!h) { await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error_code: 'no_handler', msg: name }) }); return; }
    const out = h(body, u);
    if (out && out.__redirect) { await route.fulfill({ status: 302, headers: { location: out.__redirect } }); return; }
    if (out && out.__error) { await route.fulfill({ status: out.__status || 400, contentType: 'application/json', body: JSON.stringify({ error_code: out.__error, msg: out.__error }) }); return; }
    if (out == null) { await route.fulfill({ status: 204, body: '' }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await ctx.route('**/rest/v1/rpc/**', async (route) => {
    const req = route.request();
    const fn = new URL(req.url()).pathname.split('/').pop();
    let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
    calls.push({ name: fn, args: body, auth: req.headers()['authorization'] || null });
    const h = handlers[fn];
    if (!h) { await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'no handler: ' + fn }) }); return; }
    const out = h(body);
    if (out && out.__error) { await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: out.__error }) }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out === undefined ? null : out) });
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
  await mockSupabase(ctx, handlers, calls);
  return ctx;
}

const ME = { email: 'a@b.com', name: null, plan: 'free', planExpiresAt: null, isAdmin: false, createdAt: 1 };

/* ── 1) 비밀번호 로그인: 토큰이 저장되고 계정 페이지로 이동 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'token:password': () => session('RT-1'),
    tim_me: () => ME,
    tim_ensure_profile: () => ({ created: true, plan: 'free' }),
  }, calls);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(base + '/pdf/login/', { waitUntil: 'networkidle' });
  ok(await page.locator('#loginForm').isVisible(), '로그인 폼 노출(백엔드 설정됨)');
  await page.fill('#email', 'A@B.com');
  await page.fill('#password', 'passw0rd');
  await Promise.all([page.waitForURL(/\/pdf\/account\//), page.click('#loginForm button[type=submit]')]);
  ok(true, '로그인 성공 → 계정 페이지로 이동');

  const signIn = calls.find((c) => c.name === 'token:password');
  ok(signIn && signIn.args.email === 'a@b.com', `이메일 소문자 정규화 (${signIn && signIn.args.email})`);

  const stored = await page.evaluate(() => ({
    jwt: !!localStorage.getItem('mdtl-auth-jwt'),
    rt: localStorage.getItem('mdtl-auth-refresh'),
  }));
  ok(stored.jwt && stored.rt === 'RT-1', '액세스·리프레시 토큰 저장됨');
  ok(await page.locator('#emailLabel').textContent() === 'a@b.com', '계정 페이지에 이메일 표시');

  const authed = calls.filter((c) => c.name === 'tim_me' && c.auth);
  ok(authed.length > 0, 'tim_me 호출에 Authorization 헤더가 붙음');
  ok(errs.length === 0, 'JS 오류 없음' + (errs[0] ? ': ' + errs[0] : ''));
  await ctx.close();
}

/* ── 2) 로그인 실패: 계정 존재 여부를 드러내지 않는 단일 문구 ── */
{
  const calls = [];
  const ctx = await newCtx({ 'token:password': () => ({ __error: 'invalid_credentials' }) }, calls);
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/login/', { waitUntil: 'networkidle' });
  await page.fill('#email', 'a@b.com');
  await page.fill('#password', 'wrongpass1');
  await page.click('#loginForm button[type=submit]');
  await page.waitForSelector('#msg.show', { timeout: 5000 }).catch(() => {});
  const text = await page.locator('#msg').textContent();
  ok(/Incorrect email or password/.test(text), `실패 문구 = ${text.trim()}`);
  ok(!/invalid_credentials/.test(text), '서버 내부 사유가 노출되지 않음');
  ok(await page.evaluate(() => !localStorage.getItem('mdtl-auth-refresh')), '실패 시 토큰 미저장');
  ok(!page.url().includes('/account/'), '실패 시 이동하지 않음');
  await ctx.close();
}

/* ── 3) 회원가입 비밀번호 정책은 서버 왕복 전에 클라이언트가 먼저 안내 ── */
{
  const calls = [];
  const ctx = await newCtx({ signup: () => session('RT-2') }, calls);
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
  ok(calls.filter((c) => c.name === 'signup').length === 0, '정책 위반은 서버를 호출하지 않음');
  await ctx.close();
}

/* ── 3b) 이메일 확인이 켜진 서버: 가입 응답에 세션이 없으면 "확인 메일" 안내 ── */
{
  const calls = [];
  const ctx = await newCtx({
    signup: () => ({ id: 'u1', email: 'a@b.com', confirmation_sent_at: '2026-01-01T00:00:00Z', user: { id: 'u1' } }),
  }, calls);
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/signup/', { waitUntil: 'networkidle' });
  await page.fill('#email', 'a@b.com');
  await page.check('#agree');
  await page.fill('#password', 'passw0rd1');
  await page.click('#signupForm button[type=submit]');
  await page.waitForSelector('#msg.show', { timeout: 5000 });
  const t = await page.locator('#msg').textContent();
  ok(/confirmation email/i.test(t), `세션 없는 가입 → 확인 메일 안내 — "${t.trim().slice(0, 60)}"`);
  ok(await page.evaluate(() => !localStorage.getItem('mdtl-auth-refresh')), '세션 없는 가입은 토큰 미저장');
  ok(!page.url().includes('/account/'), '계정 페이지로 이동하지 않음');
  await ctx.close();
}

/* ── 4) 만료된 액세스 토큰은 리프레시 토큰으로 자동 교환 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'token:refresh_token': (a) => (a.refresh_token === 'RT-OLD' ? session('RT-NEW') : { __error: 'unexpected' }),
    tim_me: () => ME,
    tim_ensure_profile: () => ({ created: false, plan: 'free' }),
  }, calls, { 'mdtl-auth-jwt': jwt(-60), 'mdtl-auth-refresh': 'RT-OLD' });
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/account/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#panel', { state: 'visible', timeout: 8000 });
  ok(true, '만료 토큰 상태로도 계정 페이지 진입');
  const refreshCalls = calls.filter((c) => c.name === 'token:refresh_token');
  ok(refreshCalls.length === 1, `갱신 호출 1회로 합쳐짐 (실제 ${refreshCalls.length}회)`);
  ok(await page.evaluate(() => localStorage.getItem('mdtl-auth-refresh')) === 'RT-NEW', '회전된 리프레시 토큰 저장');
  await ctx.close();
}

/* ── 5) 리프레시 실패(만료·재사용) → 세션 폐기 후 로그인 화면 ── */
{
  const calls = [];
  const ctx = await newCtx({
    'token:refresh_token': () => ({ __error: 'refresh_token_not_found' }),
    tim_me: () => null,
    tim_ensure_profile: () => ({ __error: 'not_authenticated' }),
  }, calls, { 'mdtl-auth-jwt': jwt(-60), 'mdtl-auth-refresh': 'RT-DEAD' });
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/account/', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/\/pdf\/login\//, { timeout: 8000 });
  ok(true, '갱신 실패 시 로그인 페이지로 회수');
  ok(await page.evaluate(() => !localStorage.getItem('mdtl-auth-refresh')), '죽은 리프레시 토큰 폐기됨');
  await ctx.close();
}

/* ── 6) 구글 OAuth (PKCE): verifier 보관 → 복귀 시 code 교환 + 주소창 정리 ──
   기본 배포는 google:false(공급자 미설정)라, 여기서는 설정 파일을 google:true로 바꿔치기해
   "켰을 때"의 글루 코드를 검증하고, 6b에서 꺼진 상태의 안내 분기를 검증한다. */
{
  const calls = [];
  const ctx = await newCtx({
    authorize: (b, u) => ({ __redirect: base + '/pdf/login/?code=CODE-1' }),
    'token:pkce': (b) => (b.auth_code === 'CODE-1' && b.code_verifier ? session('RT-G') : { __error: 'bad verifier' }),
    tim_me: () => ME,
    tim_ensure_profile: () => ({ created: true, plan: 'free' }),
  }, calls);
  await ctx.route('**/assets/auth-config.js', async (route) => {
    const orig = readFileSync(join(ROOT, 'pdf/assets/auth-config.js'), 'utf8');
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: orig.replace('google: false', 'google: true') });
  });
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/login/', { waitUntil: 'networkidle' });
  await page.click('#googleBtn');
  await page.waitForURL(/\/pdf\/account\//, { timeout: 10000 });
  ok(true, '구글 흐름: 인가 리다이렉트 → code 교환 → 계정 페이지');
  ok(await page.evaluate(() => localStorage.getItem('mdtl-auth-refresh')) === 'RT-G', '구글 로그인 토큰 저장');
  ok(await page.evaluate(() => !localStorage.getItem('mdtl-auth-verifier')), 'verifier는 사용 후 삭제됨');
  ok(!page.url().includes('code='), '주소창에서 1회용 code 제거됨');
  const az = calls.find((c) => c.name === 'authorize');
  const azUrl = new URL(az.url);
  ok(azUrl.searchParams.get('redirect_to').endsWith('/modutool/pdf/login/'), `redirect_to = ${azUrl.searchParams.get('redirect_to')}`);
  ok(azUrl.searchParams.get('code_challenge_method') === 's256' && !!azUrl.searchParams.get('code_challenge'), 'PKCE 챌린지 동봉');
  const px = calls.find((c) => c.name === 'token:pkce');
  ok(px && px.args.code_verifier && px.args.code_verifier.length >= 40, '교환 요청에 verifier 동봉');
  await ctx.close();
}

/* ── 6b) 구글 미설정(google:false 기본값): 서버 호출 없이 안내 문구 ── */
{
  const calls = [];
  const ctx = await newCtx({}, calls);
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/login/', { waitUntil: 'networkidle' });
  await page.click('#googleBtn');
  await page.waitForSelector('#msg.show', { timeout: 5000 });
  ok(/not available/i.test(await page.locator('#msg').textContent()), '구글 꺼짐 → 안내 문구');
  ok(calls.length === 0, '구글 꺼짐 상태에선 백엔드 호출 0건');
  await ctx.close();
}

/* ── 7) 로그아웃 / 모든 기기 로그아웃 ── */
{
  const calls = [];
  const ctx = await newCtx({
    tim_me: () => ME,
    tim_ensure_profile: () => ({ created: false, plan: 'free' }),
    logout: () => null,
    'logout:global': () => null,
  }, calls, { 'mdtl-auth-jwt': jwt(3600), 'mdtl-auth-refresh': 'RT-3' });
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/account/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#panel', { state: 'visible' });
  await page.click('#logoutAllBtn');
  await page.waitForURL((u) => !u.pathname.includes('/account/'), { timeout: 8000 });
  ok(calls.some((c) => c.name === 'logout:global'), '전체 로그아웃이 scope=global 로 서버 세션 무효화를 호출');
  ok(calls.some((c) => c.name === 'logout'), '이 기기 세션도 종료');
  const left = await page.evaluate(() => ['mdtl-auth-jwt', 'mdtl-auth-refresh', 'mdtl-plan']
    .filter((k) => localStorage.getItem(k) !== null));
  ok(left.length === 0, `로컬 토큰·플랜 캐시 정리됨 (남은 키: ${left.join(', ') || '없음'})`);
  await ctx.close();
}

/* ── 8) 계정 삭제: 이메일이 일치해야만 호출된다 ── */
{
  const calls = [];
  const ctx = await newCtx({
    tim_me: () => ME,
    tim_ensure_profile: () => ({ created: false, plan: 'free' }),
    tim_delete_account: () => ({ ok: true }),
    logout: () => null,
  }, calls, { 'mdtl-auth-jwt': jwt(3600), 'mdtl-auth-refresh': 'RT-4' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/pdf/account/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#panel', { state: 'visible' });
  await page.locator('details').click();               // 접힌 영역 펼치기

  await page.fill('#delEmail', 'someone-else@x.com');
  await page.click('#delBtn');
  await page.waitForTimeout(200);
  ok(!calls.some((c) => c.name === 'tim_delete_account'), '이메일 불일치면 삭제를 호출하지 않음');
  ok(/does not match/.test(await page.locator('#msg').textContent()), '불일치 안내 표시');

  await page.fill('#delEmail', 'a@b.com');
  await page.click('#delBtn');
  await page.waitForURL((u) => !u.pathname.includes('/account/'), { timeout: 8000 });
  const del = calls.find((c) => c.name === 'tim_delete_account');
  ok(del && del.args.p_confirm_email === 'a@b.com', '일치 시에만 삭제 호출 (p_confirm_email 인자 번역)');
  await ctx.close();
}

/* ── 9) 백오피스: 로그인 안 했으면 대시보드를 부르지 않고 로그인으로 보낸다 ── */
{
  const calls = [];
  const ctx = await newCtx({ tim_dashboard: () => ({ __error: 'forbidden' }) }, calls);
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
    tim_dashboard: () => ({ __error: 'forbidden' }),
    tim_contact_list: () => ({ __error: 'forbidden' }),
  }, calls, { 'mdtl-auth-jwt': jwt(3600), 'mdtl-auth-refresh': 'RT-5' });
  const page = await ctx.newPage();
  await page.goto(base + '/pdf/admin/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#denied', { state: 'visible', timeout: 8000 });
  const t = await page.locator('#denied').textContent();
  ok(/관리자로 등록되어 있지 않습니다/.test(t), '관리자 아님 안내 표시');
  ok(/tim_admin_users/.test(t), '안내가 Supabase 시드 경로(tim_admin_users)를 가리킴');
  ok(!/forbidden/.test(t), '서버 원문 메시지가 노출되지 않음');
  await ctx.close();
}

/* ── 11) 구 Convex 흔적이 남아있지 않은지 ── */
{
  const ctx = await newCtx({}, []);
  const page = await ctx.newPage();
  const hits = [];
  page.on('request', (r) => { if (/convex\.(site|cloud)/.test(r.url())) hits.push(r.url()); });
  await page.goto(base + '/pdf/login/', { waitUntil: 'networkidle' });
  const src = await page.evaluate(() => Array.from(document.scripts).map((s) => s.src).join(' '));
  ok(hits.length === 0, `convex 요청 0건 (실제 ${hits.length})`);
  ok(!/vendor\/convex/.test(src), 'convex 벤더 스크립트 미참조');
  ok(await page.evaluate(() => typeof window.MDTL_CONVEX === 'undefined'), '전역 MDTL_CONVEX 제거됨 (undefined)');
  await ctx.close();
}

/* ── 12) 한국어 페이지도 같은 흐름으로 동작 (문구·이동 경로만 다름) ── */
{
  const calls = [];
  const ctx = await newCtx({
    'token:password': () => session('RT-KO'),
    tim_me: () => ME,
    tim_ensure_profile: () => ({ created: false, plan: 'free' }),
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
