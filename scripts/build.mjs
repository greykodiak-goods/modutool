#!/usr/bin/env node
/* 정적 빌드: 레포 루트 → dist/
   1) __ORIGIN__ 토큰을 실제 배포 도메인으로 치환
   2) sitemap.xml·robots.txt 자동 생성 (noindex 페이지 제외)
   사용: node scripts/build.mjs [https://배포도메인] [outDir]
   도메인 생략 시 env DEPLOY_ORIGIN → CF_PAGES_URL(Cloudflare Pages 자동 제공) 순으로 사용.
   → Cloudflare Pages에서는 env에 DEPLOY_ORIGIN=https://modutool.pages.dev 하나만 넣고
     빌드 명령을 `node scripts/build.mjs`로 두면 된다. 커스텀 도메인 전환 시 이 env만 바꾸면
     canonical/hreflang/sitemap이 전부 새 도메인으로 재생성된다. */
import { cpSync, readdirSync, readFileSync, writeFileSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const origin = (process.argv[2] || process.env.DEPLOY_ORIGIN || process.env.CF_PAGES_URL || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(origin)) {
  console.error('사용법: node scripts/build.mjs https://배포도메인 [출력폴더]  (또는 env DEPLOY_ORIGIN/CF_PAGES_URL)');
  process.exit(1);
}
const out = process.argv[3] || join(root, 'dist');

const SKIP = new Set(['dist', 'scripts', 'node_modules', 'tests', '.git']);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const name of readdirSync(root)) {
  if (SKIP.has(name)) continue;
  cpSync(join(root, name), join(out, name), { recursive: true });
}

const pages = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.html')) continue;
    let html = readFileSync(p, 'utf8');
    html = html.replaceAll('__ORIGIN__', origin);
    writeFileSync(p, html);
    if (name === 'index.html' && !/noindex/.test(html)) {
      const rel = p.slice(out.length).replace(/\\/g, '/').replace(/index\.html$/, '');
      pages.push(origin + rel);
    }
  }
}
walk(out);

writeFileSync(join(out, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  pages.sort().map(u => `  <url><loc>${u}</loc></url>`).join('\n') +
  '\n</urlset>\n');
writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);

console.log(`빌드 완료 → ${out} (색인 페이지 ${pages.length}개, origin=${origin})`);
