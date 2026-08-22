/* 기능 검증 커버리지 감사 — "도구를 추가했는데 결과물 테스트를 안 붙인" 경우를 잡는다.

   왜 필요한가: 2026-07-26 실측에서 도구 40개 중 22개가 "페이지가 열리고 JS 오류가 없다"까지만
   확인돼 있었다. 계산기가 틀린 숫자를 내거나 PDF가 깨진 파일을 내줘도 아무도 몰랐을 상태다.
   사람이 기억으로 관리하면 반드시 다시 새므로(이번 프로젝트에서 같은 형태의 사고가 3번 났다)
   목록이 아니라 규칙으로 막는다.

   판정: 도구 slug가 아래 기능 테스트 파일 중 하나에라도 등장하면 커버된 것으로 본다.
   느슨한 판정이지만 "아예 손도 안 댄 도구"를 잡는 게 목적이라 이 정도면 충분하다.
   (테스트가 실제로 무엇을 검증하는지는 각 파일의 주석과 단언문이 책임진다.) */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/* 도구가 아닌 폴더 — 여기 추가할 일이 생기면 "정말 도구가 아닌지" 한 번 더 생각할 것 */
const NOT_TOOL = new Set([
  'assets', 'convex', 'docs', 'node_modules', 'scripts', 'supabase', 'tests', 'portal', 'dist', 'ko', 'mobile',
  'about', 'privacy', 'terms', 'pricing', 'login', 'signup', 'account', 'admin', 'contact', 'product-contract',
]);

/* 결과물(다운로드·픽셀·계산값)을 실제로 확인하는 테스트들 */
const FUNC_TESTS = [
  'calc-func', 'pdf-func', 'image-func', 'video2-func', 'contact-func',
  'redact-func', 'cv-tools-func', 'video-trim-func', 'audio-tools-func',
  'smoke-pdf-merge', 'pwa-offline', 'umbrella-smoke',
];

const tools = readdirSync(root).filter((n) => {
  if (n.startsWith('.') || NOT_TOOL.has(n)) return false;
  try { return statSync(join(root, n)).isDirectory(); } catch { return false; }
}).sort();

const blob = FUNC_TESTS.map((f) => {
  try { return readFileSync(join(root, 'tests', `${f}.mjs`), 'utf8'); } catch { return ''; }
}).join('\n');

// slug가 경로(/slug/)로든 인자('slug')로든 등장하면 커버로 본다
const mentions = (slug) =>
  blob.includes(`/${slug}/`) || blob.includes(`'${slug}'`) || blob.includes(`"${slug}"`);

const covered = tools.filter(mentions);
const bare = tools.filter((t) => !mentions(t));

console.log(`도구 ${tools.length}개 · 기능 검증 ${covered.length}개 · 미검증 ${bare.length}개\n`);
if (bare.length) {
  console.log('■ 결과물 검증이 없는 도구 (페이지 로드만 확인됨):');
  for (const t of bare) console.log('   -', t);
  console.log('\n해당 도구의 산출물을 실제로 열어보는 단언을 tests/ 아래 기능 테스트에 추가하세요.');
  console.log('(어느 파일에 넣을지는 카테고리를 따르면 됩니다: calc-func / pdf-func / image-func / video2-func)');
  process.exit(1);
}
console.log('✅ 전 도구가 결과물 검증을 갖고 있습니다.');
console.log('   ' + covered.join(', '));
