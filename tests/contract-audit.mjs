/* 제품 계약 래칫 — "기획 없이 구현만 추가"를 잡는다 (coverage-audit와 같은 철학).
   ① 동결 목록에 없는 도구 폴더는 product-contract/tools/<slug>.yaml 필수(필수 키 포함)
   ② 계약의 tests:에 적힌 파일이 실존하고 그 안에 slug가 등장해야 함(명세→테스트 추적성)
   ③ events.yaml의 outcome·meta 화이트리스트가 convex/telemetry.ts 실코드와 일치해야 함
   사용: node tests/contract-audit.mjs */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { repoDir } from './_pw.mjs';

const root = repoDir();
const require = createRequire(join(root, 'package.json'));
const yaml = require('js-yaml');

/* 도구가 아닌 폴더 — coverage-audit.mjs와 같은 기준을 유지할 것 */
const NOT_TOOL = new Set([
  'assets', 'convex', 'docs', 'node_modules', 'scripts', 'supabase', 'tests', 'portal', 'dist', 'ko', 'mobile',
  'about', 'privacy', 'terms', 'pricing', 'login', 'signup', 'account', 'admin', 'contact',
  'product-contract',
]);

/* 계약 도입(2026-08-21) 이전부터 있던 도구 — 소급 작성 시 여기서 제거(목록은 줄어들기만 한다) */
const FROZEN = new Set([
  'age-calculator', 'audio-trim', 'char-count', 'dday-calculator',
  'image-bg-remove', 'image-color-picker', 'image-compress', 'image-convert', 'image-crop',
  'image-exif', 'image-object-remove', 'image-redact', 'image-resize', 'image-rotate',
  'image-split', 'image-watermark', 'img-to-pdf', 'interest-calculator', 'password-generator',
  
  'percent-calculator', 'pyeong-calculator',
  'qr-generator', 'text-diff', 'trig-calculator', 'unit-converter', 'vat-calculator',
  'video-compress', 'video-to-gif', 'video-to-mp3', 'video-trim',
]);

const REQUIRED_KEYS = ['id', 'purpose', 'states', 'components', 'errors', 'telemetry', 'invariants', 'tests'];

const fails = [];
const tools = readdirSync(root).filter((n) => {
  if (n.startsWith('.') || NOT_TOOL.has(n)) return false;
  try { return statSync(join(root, n)).isDirectory(); } catch { return false; }
}).sort();

// ①② 계약 존재·필수 키·테스트 추적성
let contracted = 0;
for (const slug of tools) {
  if (FROZEN.has(slug)) continue;
  const file = join(root, 'product-contract', 'tools', `${slug}.yaml`);
  if (!existsSync(file)) { fails.push(`${slug}: 계약 없음 — product-contract/tools/${slug}.yaml`); continue; }
  let doc;
  try { doc = yaml.load(readFileSync(file, 'utf8')); } catch (e) { fails.push(`${slug}: 계약 YAML 파싱 실패 — ${e.message}`); continue; }
  for (const k of REQUIRED_KEYS) if (!doc?.[k]) fails.push(`${slug}: 계약 필수 항목 누락 — ${k}`);
  if (doc?.id && doc.id !== slug) fails.push(`${slug}: 계약 id 불일치(${doc.id})`);
  for (const t of doc?.tests ?? []) {
    const p = join(root, String(t).split('#')[0].trim());
    if (!existsSync(p)) { fails.push(`${slug}: 계약이 가리키는 테스트 없음 — ${t}`); continue; }
    if (!readFileSync(p, 'utf8').includes(slug)) fails.push(`${slug}: 테스트에 slug 미등장 — ${t}`);
  }
  contracted++;
}

// ③ events.yaml ↔ Supabase tim_log_event(SQL 마이그레이션 정본) 동기
//    서버 강제력의 원본은 supabase/migrations/ 의 RPC 정의다 — 거기 화이트리스트와 계약 문서가 어긋나면 실패.
const events = yaml.load(readFileSync(join(root, 'product-contract/events.yaml'), 'utf8'));
const telSrc = readFileSync(join(root, 'supabase/migrations/2026-08-22_tim_backend_from_convex.sql'), 'utf8');
const srcOutcomes = [...telSrc.matchAll(/p->>'outcome' in \(([^)]+)\)/g)][0]?.[1].match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
const srcMeta = [...telSrc.matchAll(/where key in \(([\s\S]*?)\)/g)][0]?.[1].match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
const diff = (a, b) => [...a.filter((x) => !b.includes(x)).map((x) => `-${x}`), ...b.filter((x) => !a.includes(x)).map((x) => `+${x}`)];
const od = diff(events.outcomes, srcOutcomes);
const md = diff(events.meta_whitelist, srcMeta);
if (od.length) fails.push(`events.yaml outcomes가 telemetry.ts와 다름: ${od.join(' ')}`);
if (md.length) fails.push(`events.yaml meta_whitelist가 telemetry.ts와 다름: ${md.join(' ')}`);

console.log(`도구 ${tools.length}개 · 동결 ${[...FROZEN].filter((f) => tools.includes(f)).length}개 · 계약 보유 ${contracted}개`);
if (fails.length) {
  console.error(`\n❌ 계약 검사 실패 ${fails.length}건:`);
  fails.forEach((f) => console.error('  ' + f));
  process.exit(1);
}
console.log('✅ 제품 계약 검사 통과 (신규 도구 계약 래칫 + 이벤트 계약 동기)');
