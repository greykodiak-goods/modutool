/* 모바일 앱(Capacitor) 웹 번들 생성 — mobile/www
   = 폐쇄망 번들(OFFLINE=1 SITE=pdf)과 동일: 회원·수집·광고 없음, 도구 전부 기기 안에서 동작.
   스토어 심사 관점에서도 이 선택이 맞다 — 계정이 없으면 계정삭제·개인정보 수집 고지 항목이 비고,
   "파일이 기기를 떠나지 않는다"는 제품 약속이 앱에서도 그대로 성립한다.
   + 스토어용 PNG 아이콘(1024·512·192)을 icon.svg 에서 렌더해 mobile/icons/ 에 둔다(Playwright). */
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

// Android 런처: 밀도별 ic_launcher / ic_launcher_round + 적응형 전경(108dp 캔버스, 아이콘은 안전영역 66%)
const res = join(mobile, 'android/app/src/main/res');
const DPI = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DPI)) {
  await renderIcon(join(res, `mipmap-${d}/ic_launcher.png`), 48 * k);
  await renderIcon(join(res, `mipmap-${d}/ic_launcher_round.png`), 48 * k);
  await renderIcon(join(res, `mipmap-${d}/ic_launcher_foreground.png`), 108 * k, 0.66);
}
// iOS: Xcode 14+ 단일 1024 AppIcon (Contents.json 이 이 파일명을 가리킨다)
await renderIcon(join(mobile, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), 1024, 1, '#2563eb');

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
icons → ${iconsDir} (+ android mipmap/splash, ios AppIcon/Splash 갱신)`);
if (!existsSync(join(www, 'index.html'))) process.exit(1);
