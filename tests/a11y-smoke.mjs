/* 접근성 스모크 — 헌장(app.charter.yaml) a11y: wcag-aa 이행 1차.
   검증된 라이브러리(axe-core)를 실브라우저에 주입해 WCAG 2.0/2.1 A·AA 규칙을 돌린다.
   게이트: serious·critical 위반 = 실패. moderate·minor는 보고만(다음 단계에서 조임 — 래칫 방향).
   사용: node tests/a11y-smoke.mjs  (사전조건: 우산 빌드가 dist/에 있음) */
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
import { loadChromium, launchOptions, distDir, repoDir } from './_pw.mjs';

const chromium = loadChromium();
const require = createRequire(join(repoDir(), 'package.json'));
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const ROOT = distDir();
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

/* 대표 사용자 흐름의 페이지들 — 포털·허브·핵심 도구·상거래 페이지, 한·영 각 1 이상 */
const PAGES = ['/', '/pdf/', '/pdf/pdf-merge/', '/pdf/ko/pdf-merge/', '/pdf/ko/pricing/', '/pdf/login/', '/calc/age-calculator/'];
const GATE_IMPACTS = new Set(['serious', 'critical']);

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
let gateFails = 0;
for (const path of PAGES) {
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.evaluate(axeSource);
  const result = await page.evaluate(async () => {
    // 광고 슬롯(외부 콘텐츠 자리)은 우리 통제 밖 — 제외하고 우리 마크업만 판정
    return await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
      exclude: [['.ad-slot']],
    });
  });
  const gate = result.violations.filter((v) => GATE_IMPACTS.has(v.impact));
  const soft = result.violations.filter((v) => !GATE_IMPACTS.has(v.impact));
  const label = path.padEnd(24);
  if (gate.length) {
    gateFails += gate.length;
    console.log(`FAIL ${label} serious+ ${gate.length}건`);
    for (const v of gate) console.log(`     · [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}곳, 예: ${v.nodes[0]?.target?.[0] ?? '?'})`);
  } else {
    console.log(`PASS ${label} serious+ 0건${soft.length ? ` (보고만: ${soft.map((v) => v.id).join(', ')})` : ''}`);
  }
}
await browser.close();
server.close();

if (gateFails) {
  console.error(`\n❌ 접근성 게이트 실패 — serious/critical ${gateFails}건`);
  process.exit(1);
}
console.log('\n✅ 접근성 스모크 통과 (WCAG A·AA, serious/critical 0건)');
