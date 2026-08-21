/* 증거팩 생성 — 대표 검수용 한 묶음: 핵심 화면 스크린샷(데스크톱·모바일) + 요약.
   목적: 대표가 브라우저를 직접 열어 재현하지 않아도, CI가 "지금 사용자에게 보이는 모습"을
   찍어 증거로 남긴다. CI에서 전 게이트 통과 후 실행되고 Actions 아티팩트로 업로드된다.
   사용: node tests/evidence-pack.mjs [출력폴더=evidence]  (사전조건: 우산 빌드가 dist/에 있음) */
import { createServer } from 'node:http';
import { readFileSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { loadChromium, launchOptions, distDir } from './_pw.mjs';

const chromium = loadChromium();
const OUT = process.argv[2] || 'evidence';
const ROOT = distDir();
const PREFIX = '/modutool';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };

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

/* 검수 대상: 포털 + 브랜드 허브 4종 + 대표 도구 + 상거래 관련 페이지(가격·방침) */
const PAGES = [
  ['portal', '/'],
  ['pdf-hub', '/pdf/'],
  ['pdf-merge', '/pdf/pdf-merge/'],
  ['pricing-ko', '/pdf/ko/pricing/'],
  ['privacy-ko', '/pdf/ko/privacy/'],
  ['img-hub', '/img/'],
  ['calc-hub', '/calc/'],
  ['video-hub', '/video/'],
];
const VIEWPORTS = [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile', { width: 390, height: 844 }],
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(launchOptions());
const shots = [];
const errors = [];
for (const [vpName, vp] of VIEWPORTS) {
  const page = await browser.newPage({ viewport: vp });
  page.on('pageerror', (e) => errors.push(`${vpName}: ${e.message}`));
  for (const [name, path] of PAGES) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    const file = `${name}--${vpName}.png`;
    await page.screenshot({ path: join(OUT, file) });
    shots.push(file);
  }
  await page.close();
}
await browser.close();
server.close();

let commit = process.env.GITHUB_SHA || '';
try { if (!commit) commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); } catch (e) {}

writeFileSync(join(OUT, 'summary.md'), `# Release Evidence Pack

- 생성: ${new Date().toISOString()}
- 커밋: ${commit}
- 화면: ${PAGES.length}페이지 × ${VIEWPORTS.length}뷰포트(데스크톱 1280 / 모바일 390) = ${shots.length}장
- 페이지 JS 오류: ${errors.length}건${errors.length ? '\n  - ' + errors.join('\n  - ') : ''}

이 팩은 CI에서 단위→타입→래칫→보안감사→빌드→브라우저 전 스위트가 **모두 통과한 뒤에만** 생성된다.
(하나라도 실패하면 워크플로가 여기 도달하지 못하므로, 팩의 존재 자체가 게이트 통과의 증거다.)

## 스크린샷
${shots.map((s) => `- ${s}`).join('\n')}
`);

if (errors.length) {
  console.error(`❌ 증거팩 생성 중 페이지 JS 오류 ${errors.length}건 — summary.md 참조`);
  process.exit(1);
}
console.log(`✅ 증거팩 생성 — ${OUT}/ (스크린샷 ${shots.length}장 + summary.md)`);
