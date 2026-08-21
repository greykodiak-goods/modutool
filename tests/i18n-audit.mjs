/* 글로벌(i18n) 래칫 — "새 기능이 다국어에서 빠지는 것"을 CI에서 막는다.
   요구의 원본은 헌장(app.charter.yaml)이다: locales에 언어를 추가하면 이 검사가
   전 도구·지원 페이지의 해당 언어판을 즉시 요구한다(요구가 기억이 아니라 파일에 산다).

   검사:
   ① 모든 도구가 모든 locale에 존재 (기본 locale=루트, 그 외=/<locale>/<slug>/)
   ② 지원 페이지(about·privacy·terms·pricing·login·signup·account·contact)도 동일
      — 헌장 exceptions(admin 등)만 예외
   ③ 고아 페이지: locale 경로에만 있고 기본 locale에 없는 페이지 검출
   ④ 모든 페이지에 hreflang 3종(en·ko·x-default — locale 수와 동기) + canonical 존재
   사용: node tests/i18n-audit.mjs */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { repoDir } from './_pw.mjs';

const root = repoDir();
const require = createRequire(join(root, 'package.json'));
const yaml = require('js-yaml');

const charter = yaml.load(readFileSync(join(root, 'app.charter.yaml'), 'utf8'));
const { locales, defaultLocale, exceptions = [] } = charter.crossCutting.i18n;
const otherLocales = locales.filter((l) => l !== defaultLocale);

/* 페이지가 아닌 폴더 — coverage-audit.mjs와 같은 기준 + locale 경로 자신 */
const NOT_PAGE = new Set([
  'assets', 'convex', 'docs', 'node_modules', 'scripts', 'supabase', 'tests', 'portal', 'dist',
  'product-contract', ...locales,
]);

const fails = [];
const pageDirs = (base) => {
  if (!existsSync(base)) return [];
  return readdirSync(base).filter((n) => {
    if (n.startsWith('.') || NOT_PAGE.has(n)) return false;
    try { return statSync(join(base, n)).isDirectory() && existsSync(join(base, n, 'index.html')); } catch { return false; }
  });
};

const defaultPages = pageDirs(root).filter((p) => !exceptions.includes(p));

// ①② 기본 locale의 모든 페이지가 다른 locale에도 존재
for (const loc of otherLocales) {
  for (const p of defaultPages) {
    if (!existsSync(join(root, loc, p, 'index.html'))) fails.push(`${p}: ${loc} 페이지 없음 (${loc}/${p}/index.html)`);
  }
  // ③ 고아: locale에만 있는 페이지
  for (const p of pageDirs(join(root, loc))) {
    if (!exceptions.includes(p) && !existsSync(join(root, p, 'index.html'))) fails.push(`${loc}/${p}: 기본 locale(${defaultLocale}) 페이지 없음 — 고아`);
  }
}

// ④ hreflang·canonical — 전 페이지 정적 검사 (렌더 검사는 structural.mjs가 표본 수행)
const wantHreflangs = [...locales, 'x-default'].sort();
const checkHead = (file, label) => {
  const html = readFileSync(file, 'utf8');
  const langs = [...html.matchAll(/hreflang="([^"]+)"/g)].map((m) => m[1]).sort();
  if (JSON.stringify(langs) !== JSON.stringify(wantHreflangs)) fails.push(`${label}: hreflang 불일치 [${langs.join(',')}] ≠ [${wantHreflangs.join(',')}]`);
  if (!/rel="?canonical"?/.test(html)) fails.push(`${label}: canonical 없음`);
};
for (const p of defaultPages) {
  checkHead(join(root, p, 'index.html'), p);
  for (const loc of otherLocales) {
    const f = join(root, loc, p, 'index.html');
    if (existsSync(f)) checkHead(f, `${loc}/${p}`);
  }
}

console.log(`locales [${locales.join(', ')}] · 페이지 ${defaultPages.length}종 × ${locales.length}개 언어 · 예외 [${exceptions.join(', ')}]`);
if (fails.length) {
  console.error(`\n❌ i18n 검사 실패 ${fails.length}건:`);
  fails.forEach((f) => console.error('  ' + f));
  process.exit(1);
}
console.log('✅ 글로벌 래칫 통과 — 전 페이지가 전 locale에 존재하고 hreflang·canonical 완비');
