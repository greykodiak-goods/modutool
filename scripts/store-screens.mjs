/* 스토어 제출용 이미지 — mobile/www 를 그대로 폰 뷰포트로 찍는다(앱 번들과 동일 화면). fastlane 이 읽는 경로로 바로 낸다.
   · iPhone 6.7"(1290×2796, App Store 필수 규격) → mobile/fastlane/screenshots/ios/<locale>/
   · Android 폰(1080×1920)                      → mobile/fastlane/metadata/android/<locale>/images/phoneScreenshots/
   · Play 피처 그래픽(1024×500, 필수)            → mobile/fastlane/metadata/android/<locale>/images/featureGraphic.png
   전부 생성물(gitignore) — CI 가 매 릴리즈마다 새로 만든다. */
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'mobile', 'www');
const fl = join(root, 'mobile', 'fastlane');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(www, p);
  try { if (statSync(f).isFile()) { res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); return; } } catch {}
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright');
const browser = await chromium.launch();

/* locale → (스토어별 폴더명, 페이지 경로 접두) */
const LOCALES = [
  { ios: 'en-US', android: 'en-US', prefix: '' },
  { ios: 'ko', android: 'ko-KR', prefix: '/ko' },
];
const PAGES = [['1-home', '/'], ['2-merge', '/pdf-merge/'], ['3-compress', '/pdf-compress/'], ['4-sign', '/pdf-sign/'], ['5-split', '/pdf-split/']];
const DEVICES = {
  ios: { width: 430, height: 932, scale: 3, dir: (l) => join(fl, 'screenshots', 'ios', l.ios) },
  android: { width: 360, height: 640, scale: 3, dir: (l) => join(fl, 'metadata', 'android', l.android, 'images', 'phoneScreenshots') },
};
for (const [dev, v] of Object.entries(DEVICES)) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  // 언어 제안 배너는 스크린샷에 불필요 — 현재 언어로 고정
  await ctx.addInitScript(() => { try { localStorage.setItem('mdtl-lang', location.pathname.startsWith('/ko') ? 'ko' : 'en'); } catch (e) {} });
  for (const loc of LOCALES) {
    const out = v.dir(loc); mkdirSync(out, { recursive: true });
    for (const [name, path] of PAGES) {
      await page.goto(base + loc.prefix + path, { waitUntil: 'networkidle' });
      await page.screenshot({ path: join(out, `${name}.png`) });
    }
  }
  await ctx.close();
}

/* Play 피처 그래픽 1024×500 — 브랜드 배경 + 아이콘 + 태그라인 */
const svgData = 'data:image/svg+xml;base64,' + readFileSync(join(www, 'icon.svg')).toString('base64');
const TAGLINE = { 'en-US': 'PDF tools that never upload your files', 'ko-KR': '파일을 업로드하지 않는 PDF 도구' };
const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 } });
const page = await ctx.newPage();
for (const loc of LOCALES) {
  await page.setContent(`<body style="margin:0;width:1024px;height:500px;background:#2563eb;display:flex;align-items:center;justify-content:center;gap:48px;font-family:system-ui,sans-serif;color:#fff">
    <div style="background:#fff;border-radius:48px;padding:18px;display:flex"><img src="${svgData}" width="200" height="200"></div><div><div style="font-size:72px;font-weight:800;letter-spacing:-1px">ThisIsMyPDF</div><div style="font-size:30px;opacity:.92;margin-top:10px">${TAGLINE[loc.android]}</div></div></body>`, { waitUntil: 'load' });
  const dir = join(fl, 'metadata', 'android', loc.android, 'images'); mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, 'featureGraphic.png') });
}
await browser.close(); server.close();
console.log(`store images → ${fl}/screenshots/ios/*, metadata/android/*/images/*`);
