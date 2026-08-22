/* 네이티브 앱(Capacitor) 계약 검증 — 브라우저 없이도 깨지면 바로 보이는 두 가지.
   ① mdtlDownload: 앱(WebView)에서는 <a download> 대신 Filesystem.writeFile → Share.share 로 넘어가야 한다.
      (iOS WebView는 download 속성에 무반응 — 도구가 "완료"라고 해놓고 파일이 안 나오는 사고를 막는다)
      웹에서는 기존 경로(a[download])가 그대로여야 한다.
   ② 웹 빌드(dist/)에 mobile/ 이 섞이면 안 된다 — 빌드가 출력 폴더를 자기 안으로 재귀 복사하다 멈추는
      사고(2026-08-22)의 재발 방지 + 네이티브 프로젝트가 공개 사이트로 새는 것 차단. */
import { loadChromium, launchOptions, distDir, repoDir } from './_pw.mjs';
import { existsSync } from 'node:fs';
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

await browser.close();
console.log(fails ? `\n${fails} FAIL` : '\nnative-bridge: ALL PASS');
process.exit(fails ? 1 : 0);
