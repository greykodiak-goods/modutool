#!/usr/bin/env node
/* 우산(umbrella) 조립 빌드 — 최종 구조:
     /            = 포털(모든 도구 한 화면, portal/ 소스)
     /pdf/        = ThisIsMyPDF   (SITE=pdf)
     /img/        = ThisIsMyIMG   (SITE=img)
     /calc/       = ThisIsMyCalculator (SITE=calc, util 카테고리 포함)
   + 구 루트 툴 URL → 새 브랜드 경로 리다이렉트 스텁
   + 루트 sitemap index(3개 서브사이트 sitemap 참조) / robots.txt / 404
   사용: node scripts/build-all.mjs https://오리진 [BASE_PATH=/modutool]
   (오리진에는 base 경로까지 포함: https://greykodiak-goods.github.io/modutool) */
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const origin = (process.argv[2] || process.env.DEPLOY_ORIGIN || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(origin)) {
  console.error('사용법: node scripts/build-all.mjs https://오리진 (BASE_PATH env 선택)');
  process.exit(1);
}
const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

/* 1) 서브사이트 3종 (전부 색인 허용 — 각자 정본 URL) */
for (const key of ['pdf', 'img', 'calc', 'video']) {
  execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), `${origin}/${key}`, join(dist, key)], {
    env: { ...process.env, SITE: key, BASE_PATH: `${base}/${key}`, NOINDEX: '' },
    stdio: 'inherit',
  });
}

/* 2) 포털 (루트 + /ko) — 상대링크라 base 무관, __ORIGIN__만 치환 */
for (const [src, dst] of [['portal/index.html', 'index.html'], ['portal/ko/index.html', 'ko/index.html']]) {
  const html = readFileSync(join(root, src), 'utf8').replaceAll('__ORIGIN__', origin);
  mkdirSync(dirname(join(dist, dst)), { recursive: true });
  writeFileSync(join(dist, dst), html);
}

/* 2.5) Cloudflare Pages 헤더 — 정본 전환 대비(_headers). GitHub Pages·Netlify는 무시한다. */
if (existsSync(join(root, '_headers'))) cpSync(join(root, '_headers'), join(dist, '_headers'));

/* 3) 구 루트 URL 리다이렉트 스텁 (site.js CAT_SLUGS와 동기 유지할 것) */
const REDIRECTS = {
  pdf: ['pdf-merge','pdf-split','pdf-extract','pdf-organize','pdf-rotate','pdf-compress','pdf-watermark','pdf-page-numbers','pdf-sign','pdf-to-jpg','img-to-pdf',
        'about','privacy','terms','pricing','login','signup','account','admin','contact'],
  img: ['image-compress','image-resize','image-crop','image-convert','image-rotate','image-watermark'],
  calc: ['age-calculator','percent-calculator','char-count','dday-calculator','trig-calculator','pyeong-calculator'],
};
let stubs = 0;
function stub(oldPath, newUrl) {
  const dir = join(dist, oldPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">` +
    `<link rel="canonical" href="${newUrl}"><meta http-equiv="refresh" content="0; url=${newUrl}">` +
    `<title>Moved</title></head><body><p>This page has moved: <a href="${newUrl}">${newUrl}</a></p></body></html>\n`);
  stubs++;
}
for (const [site, slugs] of Object.entries(REDIRECTS)) {
  for (const slug of slugs) {
    stub(slug, `${origin}/${site}/${slug}/`);
    stub(join('ko', slug), `${origin}/${site}/ko/${slug}/`);
  }
}

/* 4) 루트 sitemap index + robots + 404
   포털(/ 와 /ko/)은 브랜드 sitemap 어디에도 안 들어간다(브랜드 빌드 산출물이 아니므로).
   전 도구를 모아 보여주는 대표 랜딩인데 sitemap에서 빠져 있으면 색인이 늦다 →
   포털 전용 sitemap을 따로 만들어 index에 함께 싣는다. */
writeFileSync(join(dist, 'sitemap-portal.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  [`${origin}/`, `${origin}/ko/`].map((u) => `  <url><loc>${u}</loc></url>`).join('\n') +
  '\n</urlset>\n');
writeFileSync(join(dist, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  ['sitemap-portal.xml', ...['pdf', 'img', 'calc', 'video'].map((k) => `${k}/sitemap.xml`)]
    .map((p) => `  <sitemap><loc>${origin}/${p}</loc></sitemap>`).join('\n') +
  '\n</sitemapindex>\n');
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
cpSync(join(dist, 'pdf', '404.html'), join(dist, '404.html'));

console.log(`우산 빌드 완료 → ${dist} (서브사이트 3, 리다이렉트 스텁 ${stubs}개, 포털 2p)`);
