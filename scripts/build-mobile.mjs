/* 모바일 앱(Capacitor) 웹 번들 생성 — mobile/www
   = 폐쇄망 번들(OFFLINE=1 SITE=pdf)과 동일: 회원·수집·광고 없음, 도구 전부 기기 안에서 동작.
   스토어 심사 관점에서도 이 선택이 맞다 — 계정이 없으면 계정삭제·개인정보 수집 고지 항목이 비고,
   "파일이 기기를 떠나지 않는다"는 제품 약속이 앱에서도 그대로 성립한다.
   + 스토어용 PNG 아이콘(1024·512·192)을 icon.svg 에서 렌더해 mobile/icons/ 에 둔다(Playwright).
   + Play 등록정보 아이콘(512)은 fastlane 이 읽는 metadata/android/<locale>/images/icon.png 로도 낸다. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'mobile', 'www');
rmSync(www, { recursive: true, force: true });

const r = spawnSync(process.execPath, [join(root, 'scripts/build.mjs'), 'https://localhost', www], {
  cwd: root, stdio: 'inherit', env: { ...process.env, OFFLINE: '1', SITE: 'pdf', BASE_PATH: '' },
});
if (r.status !== 0) process.exit(r.status ?? 1);
// 폐쇄망 README는 앱 번들에 불필요
rmSync(join(www, 'README.txt'), { force: true });

const mobile = join(root, 'mobile');
const iconsDir = join(mobile, 'icons');
mkdirSync(iconsDir, { recursive: true });
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
const svgData = 'data:image/svg+xml;base64,' + readFileSync(join(www, 'icon.svg')).toString('base64');

/** 브랜드색 — 불투명 배경이 필요한 아이콘(App Store·Play 등록정보)에 쓴다. icon.svg 의 바탕색과 같다. */
const BRAND_BG = '#2563eb';

/** 정사각 캔버스(size)에 아이콘을 scale 비율로 중앙 배치해 PNG로 저장. bg 없으면 투명. */
async function renderIcon(file, size, scale = 1, bg = '') {
  const px = Math.round(size * scale);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;background:${bg || 'transparent'}">` +
    `<img src="${svgData}" width="${px}" height="${px}"></body>`, { waitUntil: 'load' });
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: !bg });
}

// 스토어 등록용(Play 512 · App Store 1024 · 공용 192)
for (const size of [1024, 512, 192]) await renderIcon(join(iconsDir, `icon-${size}.png`), size);

/* Play 등록정보 아이콘 — fastlane supply 가 로케일별로 이 경로를 읽는다.
   여기가 비면 등록정보가 미완성이라 production 승격이 막힌다(업로드는 조용히 통과한다).
   규격은 512² "32-bit PNG (with alpha)" 인데, page.screenshot 은 불투명 이미지를 24-bit(알파 없음)로 인코딩한다.
   그래서 캔버스에 그려 toDataURL 로 받는다 — 알파 채널이 남는다. 배경은 Play 가 자체 마스크를 씌우므로 브랜드색 전면 채움.
   로케일 목록은 metadata 디렉터리에서 읽는다 — 로케일을 늘려도 이 스크립트는 그대로다. */
const androidMeta = join(mobile, 'fastlane/metadata/android');
const listingIcons = readdirSync(androidMeta, { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => join(androidMeta, e.name, 'images/icon.png'));
if (!listingIcons.length) { console.error(`Play 메타데이터 로케일 디렉터리가 없다: ${androidMeta}`); process.exit(1); }
const listingPng = Buffer.from((await page.evaluate(async ([src, size, bg]) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  return canvas.toDataURL('image/png');
}, [svgData, 512, BRAND_BG])).split(',')[1], 'base64');
for (const file of listingIcons) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, listingPng); }

// Android 런처: 밀도별 ic_launcher / ic_launcher_round + 적응형 전경(108dp 캔버스, 아이콘은 안전영역 66%)
const res = join(mobile, 'android/app/src/main/res');
const DPI = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DPI)) {
  await renderIcon(join(res, `mipmap-${d}/ic_launcher.png`), 48 * k);
  await renderIcon(join(res, `mipmap-${d}/ic_launcher_round.png`), 48 * k);
  await renderIcon(join(res, `mipmap-${d}/ic_launcher_foreground.png`), 108 * k, 0.66);
}
// iOS: Xcode 14+ 단일 1024 AppIcon (Contents.json 이 이 파일명을 가리킨다)
await renderIcon(join(mobile, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), 1024, 1, BRAND_BG);

// 스플래시: 2732² 배경색 위 아이콘 — Capacitor 기본(로고) 교체. iOS 3장 + Android drawable* 전부.
const splashTmp = join(iconsDir, 'splash-2732x2732.png');
await renderIcon(splashTmp, 2732, 0.19, '#f7f8fa');
const splashBuf = readFileSync(splashTmp);
for (const n of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
  writeFileSync(join(mobile, 'ios/App/App/Assets.xcassets/Splash.imageset', n), splashBuf);
for (const d of readdirSync(res).filter((n) => /^drawable(-(land|port)-\w+)?$/.test(n)))
  writeFileSync(join(res, d, 'splash.png'), splashBuf);

await browser.close();
console.log(`mobile www → ${www}
icons → ${iconsDir} (+ android mipmap/splash, ios AppIcon/Splash 갱신)
play 등록정보 아이콘 → ${listingIcons.join(', ')}`);
// 산출물이 하나라도 비면 릴리즈 워크플로가 미완성 등록정보를 그대로 올린다 — 여기서 끊는다.
const missing = [join(www, 'index.html'), ...listingIcons].filter((f) => !existsSync(f));
if (missing.length) { console.error(`산출물 누락: ${missing.join(', ')}`); process.exit(1); }
