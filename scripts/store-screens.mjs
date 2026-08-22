/* 스토어 제출용 스크린샷 — mobile/www 를 그대로 폰 뷰포트로 찍는다(앱 번들과 동일 화면).
   iPhone 6.7"(1290×2796, App Store 필수 규격) + Android 폰(1080×1920). 결과 mobile/store/ (gitignore). */
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'mobile', 'www');
const out = join(root, 'mobile', 'store');
mkdirSync(out, { recursive: true });
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
const DEVICES = { ios67: { width: 430, height: 932, scale: 3 }, android: { width: 360, height: 640, scale: 3 } };
const PAGES = [['home', '/'], ['merge', '/pdf-merge/'], ['compress', '/pdf-compress/'], ['sign', '/pdf-sign/'], ['home-ko', '/ko/'], ['split-ko', '/ko/pdf-split/']];
for (const [dev, v] of Object.entries(DEVICES)) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.scale, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const [name, path] of PAGES) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(out, `${dev}-${name}.png`) });
  }
  await ctx.close();
}
await browser.close(); server.close();
console.log(`store screenshots → ${out}`);
