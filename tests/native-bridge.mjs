/* 네이티브 앱(Capacitor) 계약 검증 — 브라우저 없이도 깨지면 바로 보이는 두 가지.
   ① mdtlDownload: 앱(WebView)에서는 <a download> 대신 Filesystem.writeFile → Share.share 로 넘어가야 한다.
      (iOS WebView는 download 속성에 무반응 — 도구가 "완료"라고 해놓고 파일이 안 나오는 사고를 막는다)
      웹에서는 기존 경로(a[download])가 그대로여야 한다.
   ② 웹 빌드(dist/)에 mobile/ 이 섞이면 안 된다 — 빌드가 출력 폴더를 자기 안으로 재귀 복사하다 멈추는
      사고(2026-08-22)의 재발 방지 + 네이티브 프로젝트가 공개 사이트로 새는 것 차단.
   ③ 파일 수신(다른 앱 → 이 앱): 문서 타입 선언(plist/manifest)이 살아 있는지 + 넘어온 파일이
      실제로 도구 드롭존까지 도달하는지. 선언만 하고 아무 일도 안 일어나면 심사에서 더 나쁘다. */
import { loadChromium, launchOptions, distDir, repoDir } from './_pw.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const chromium = loadChromium();
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }

ok(!existsSync(join(distDir(), 'mobile')), '웹 빌드(dist/)에 mobile/ 없음');
ok(!existsSync(join(distDir(), 'pdf', 'mobile')), '우산 빌드 pdf/ 에 mobile/ 없음');

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ path: join(repoDir(), 'assets/site.js') });
ok(await page.evaluate(() => typeof window.mdtlDownload === 'function'), 'site.js 로드 — mdtlDownload 존재');

/* 웹: Capacitor 없음 → a[download] 경로 */
const web = await page.evaluate(() => {
  const seen = [];
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { seen.push({ download: this.download, blob: this.href.startsWith('blob:') }); };
  window.mdtlDownload(new Blob(['x']), 'web.pdf');
  HTMLAnchorElement.prototype.click = orig;
  return seen;
});
ok(web.length === 1 && web[0].download === 'web.pdf' && web[0].blob, `웹 경로 유지: a[download=${web[0]?.download}] blob=${web[0]?.blob}`);

/* 앱: Capacitor 네이티브 → Filesystem.writeFile(CACHE, base64) → Share.share(uri) */
const native = await page.evaluate(async () => {
  const calls = { write: null, share: null, anchor: 0 };
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Filesystem: { writeFile: async (o) => { calls.write = o; return { uri: 'file:///cache/' + o.path }; } },
      Share: { share: async (o) => { calls.share = o; return {}; } },
    },
  };
  const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { calls.anchor++; };
  window.mdtlDownload(new Blob(['%PDF-1.4 test']), 'out.pdf');
  await new Promise((r) => setTimeout(r, 200));
  HTMLAnchorElement.prototype.click = orig;
  delete window.Capacitor;
  return { ...calls, decoded: calls.write ? atob(calls.write.data) : '' };
});
ok(native.anchor === 0, '앱 경로: a[download] 미사용');
ok(native.write && native.write.path === 'out.pdf' && native.write.directory === 'CACHE', `Filesystem.writeFile(path=${native.write?.path}, dir=${native.write?.directory})`);
ok(native.decoded === '%PDF-1.4 test', 'base64 본문이 원본 blob 과 일치');
ok(native.share && native.share.url === 'file:///cache/out.pdf' && native.share.title === 'out.pdf', `Share.share(url=${native.share?.url})`);

/* 앱이지만 플러그인 미설치 → 웹 경로로 안전 폴백(크래시 금지) */
const fallback = await page.evaluate(() => {
  window.Capacitor = { isNativePlatform: () => true, Plugins: {} };
  let n = 0; const orig = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { n++; };
  window.mdtlDownload(new Blob(['x']), 'fb.pdf');
  HTMLAnchorElement.prototype.click = orig; delete window.Capacitor;
  return n;
});
ok(fallback === 1, '플러그인 없는 앱 환경 → a[download] 폴백');
await page.close();

/* ── ③ 파일 수신 — 문서 타입 선언 ──
   Apple 4.2(Minimum Functionality)는 "웹사이트와 뭐가 다른가"를 묻는다. 다른 앱이 이 앱으로
   PDF 를 넘길 수 있다는 것이 그 답 중 하나이고, 그 답은 이 두 파일의 선언에서 시작한다. */
const plist = readFileSync(join(repoDir(), 'mobile/ios/App/App/Info.plist'), 'utf8');
ok(/<key>CFBundleDocumentTypes<\/key>/.test(plist), 'iOS: CFBundleDocumentTypes 선언');
ok(/<string>com\.adobe\.pdf<\/string>/.test(plist), 'iOS: LSItemContentTypes 에 com.adobe.pdf');
ok(/<key>LSSupportsOpeningDocumentsInPlace<\/key>\s*<true\/>/.test(plist), 'iOS: LSSupportsOpeningDocumentsInPlace = true');
ok(/<key>UIFileSharingEnabled<\/key>\s*<true\/>/.test(plist), 'iOS: UIFileSharingEnabled = true');
ok(!/armv7/.test(plist), 'iOS: armv7 필수 기능 잔재 없음(64비트 전용)');

const manifest = readFileSync(join(repoDir(), 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
const filters = manifest.split('<intent-filter').slice(1);
function hasFilter(action, mime) {
  return filters.some((f) => f.includes(`android.intent.action.${action}`) && f.includes(`android:mimeType="${mime}"`));
}
ok(hasFilter('VIEW', 'application/pdf'), 'Android: ACTION_VIEW(application/pdf) intent-filter');
ok(hasFilter('SEND', 'application/pdf'), 'Android: ACTION_SEND(application/pdf) intent-filter');
ok(hasFilter('SEND_MULTIPLE', 'application/pdf'), 'Android: ACTION_SEND_MULTIPLE(application/pdf) intent-filter');

/* ── ③ 파일 수신 — 넘어온 파일이 도구까지 도달하는가 ──
   네이티브가 CACHE/mdtl-intake/ 에 파일을 두고 intake.json 에 목록을 남긴다는 계약을 가짜 파일시스템으로
   재현하고, 실제 assets/site.js 를 태워 (a) 착지 도구로의 이동 (b) 드롭존 배달 (c) 소비 후 삭제를 본다. */
const PAGE = (lang, dz) => `<!doctype html><html lang="${lang}"><body>
${dz ? '<div id="dz"><input type="file"></div>' : '<p>no dropzone</p>'}
<script src="/assets/site.js"></script>
${dz ? `<script type="module">
  window.mdtlDropzone(document.getElementById('dz'), {
    accept: '.pdf,application/pdf', multiple: ${dz === 'multi'},
    onFiles: async (fs) => {
      const out = [];
      for (const f of fs) out.push({ name: f.name, type: f.type, text: await f.text() });
      await window.__deliver(location.pathname, out);
    },
  });
<\/script>` : ''}
</body></html>`;

const ROUTES = {
  '/hub/': PAGE('en', false),
  '/pdf-organize/': PAGE('en', 'single'),
  '/pdf-merge/': PAGE('en', 'multi'),
};
const srv = createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/assets/site.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(readFileSync(join(repoDir(), 'assets/site.js')));
    return;
  }
  if (ROUTES[p]) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(ROUTES[p]); return; }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${srv.address().port}`;

/* 네이티브 대기열을 흉내내는 가짜 파일시스템 — 페이지를 넘나들어도 상태가 유지되도록 Node 쪽에 둔다 */
const vfs = new Map();                     // `${directory}:${path}` → base64
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const stage = (files) => {                 // 네이티브가 한 일과 같은 상태를 만든다
  vfs.clear();
  for (const [name, body] of files) vfs.set(`CACHE:mdtl-intake/${name}`, b64(body));
  vfs.set('CACHE:mdtl-intake/intake.json', b64(JSON.stringify({ files: files.map(([n]) => n) })));
};
let delivered = [];

const ctx = await browser.newContext();
await ctx.exposeFunction('__fsRead', (dir, path) => vfs.get(`${dir}:${path}`) ?? null);
await ctx.exposeFunction('__fsDel', (dir, path) => vfs.delete(`${dir}:${path}`));
await ctx.exposeFunction('__deliver', (where, items) => { delivered.push({ where, items }); });
await ctx.addInitScript(() => {
  const utf8 = (s) => {
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(u);
  };
  window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Filesystem: {
        readFile: async (o) => {
          const data = await window.__fsRead(o.directory, o.path);
          if (data === null) throw new Error('File does not exist');
          return { data: o.encoding ? utf8(data) : data };
        },
        deleteFile: async (o) => {
          if (!(await window.__fsDel(o.directory, o.path))) throw new Error('File does not exist');
          return {};
        },
      },
      Share: { share: async () => ({}) },
    },
  };
});
const nat = await ctx.newPage();
const natErrs = [];
nat.on('pageerror', (e) => natErrs.push(String(e)));
async function waitFor(cond, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
}

/* 1개 수신 + 드롭존 없는 화면에서 시작 → 페이지 편집 도구로 이동해 배달 */
stage([['report.pdf', '%PDF-1.4 one']]);
/* commit: 이 화면은 load 직후 스스로 이동한다 — load 를 기다리면 goto 가 그 이동과 부딪힌다 */
await nat.goto(`${origin}/hub/`, { waitUntil: 'commit' });
ok(await waitFor(() => delivered.length === 1), `1개 수신 → 배달됨 (${delivered.length}건)`);
ok(delivered[0]?.where === '/pdf-organize/', `1개는 페이지 편집으로 착지 (${delivered[0]?.where})`);
ok(delivered[0]?.items[0]?.name === 'report.pdf' && delivered[0]?.items[0]?.text === '%PDF-1.4 one',
  `파일명·본문 보존 (${delivered[0]?.items[0]?.name})`);
ok(delivered[0]?.items[0]?.type === 'application/pdf', 'MIME 타입 application/pdf');
ok(await waitFor(() => vfs.size === 0), `배달 후 대기열 비움 (남은 ${vfs.size}개)`);

/* 같은 화면을 다시 봐도(앱 복귀) 이미 소비한 파일이 되살아나면 안 된다 */
delivered = [];
await nat.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
ok(!(await waitFor(() => delivered.length > 0, 500)), '소비된 대기열은 재배달되지 않음');

/* 2개 수신 → 병합으로 착지 */
delivered = [];
stage([['a.pdf', '%PDF-1.4 a'], ['b.pdf', '%PDF-1.4 b']]);
await nat.goto(`${origin}/hub/`, { waitUntil: 'commit' });
ok(await waitFor(() => delivered.length === 1), `2개 수신 → 배달됨 (${delivered.length}건)`);
ok(delivered[0]?.where === '/pdf-merge/', `2개 이상은 병합으로 착지 (${delivered[0]?.where})`);
ok(delivered[0]?.items.map((i) => i.name).join(',') === 'a.pdf,b.pdf', `순서 보존 (${delivered[0]?.items.map((i) => i.name)})`);

/* 이미 도구 화면에 있으면 이동 없이 그 자리에서 받는다 */
delivered = [];
stage([['here.pdf', '%PDF-1.4 here']]);
await nat.goto(`${origin}/pdf-merge/`);
ok((await waitFor(() => delivered.length === 1)) && delivered[0]?.where === '/pdf-merge/', '현재 도구 화면이 있으면 그 자리에서 수신');
ok(nat.url() === `${origin}/pdf-merge/`, `불필요한 이동 없음 (${nat.url()})`);

/* 대기열이 비어 있으면 아무 일도 없어야 한다 — 평상시 앱 실행이 이 경로다 */
delivered = [];
vfs.clear();
await nat.goto(`${origin}/hub/`);
ok(!(await waitFor(() => delivered.length > 0, 800)) && nat.url() === `${origin}/hub/`, '대기열이 비면 이동·배달 없음');

/* 한국어 화면에서는 한국어 도구로 착지한다 */
const landing = await nat.evaluate(() => [window.mdtlIntakeLanding(1, 'ko'), window.mdtlIntakeLanding(3, 'ko')]);
ok(landing[0] === '/ko/pdf-organize/?intake=1' && landing[1] === '/ko/pdf-merge/?intake=1', `ko 착지 경로 (${landing.join(' , ')})`);

ok(natErrs.length === 0, 'JS 오류 없음' + (natErrs[0] ? ': ' + natErrs[0] : ''));

/* 웹(브라우저)에서는 이 경로가 통째로 꺼져 있어야 한다 — 네이티브 플러그인이 없으면 조용히 아무 것도 안 한다 */
const webPage = await browser.newPage();
const webErrs = [];
webPage.on('pageerror', (e) => webErrs.push(String(e)));
await webPage.goto(`${origin}/hub/`);
await webPage.evaluate(() => window.mdtlCheckIntake());
ok(webErrs.length === 0 && webPage.url() === `${origin}/hub/`, '웹에서는 수신 경로 비활성(이동·오류 없음)');
await webPage.close();

await ctx.close();
srv.close();

await browser.close();
console.log(fails ? `\n${fails} FAIL` : '\nnative-bridge: ALL PASS');
process.exit(fails ? 1 : 0);
