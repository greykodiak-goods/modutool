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

/* ── SITE 시리즈 필터 (선택) ──
   SITE=pdf|img|calc 지정 시: 해당 사이트 카테고리 툴만 포함(다른 카테고리 툴 폴더 제외 + 허브 섹션 필터 +
   브랜드 주입 + 형제 사이트 헤더 링크). 미지정 시 전체 통합 빌드(현행 preview, 회귀 없음).
   sites.json이 정의. 카테고리→slug 매핑은 CAT_SLUGS. */
const SITE_KEY = process.env.SITE || '';
let site = null, siteSlugs = null;
const CAT_SLUGS = {
  pdf: ['pdf-merge','pdf-split','pdf-extract','pdf-organize','pdf-rotate','pdf-compress','pdf-watermark','pdf-page-numbers','pdf-sign','pdf-to-jpg','img-to-pdf'],
  image: ['image-compress','image-resize','image-crop','image-convert','image-rotate','image-watermark','img-to-pdf','image-redact','image-exif','image-split','image-color-picker'],
  calc: ['age-calculator','percent-calculator','char-count','dday-calculator','trig-calculator','pyeong-calculator','vat-calculator','interest-calculator','unit-converter'],
  util: ['qr-generator','password-generator','text-diff'],
};
const SUPPORT_SLUGS = ['about','privacy','terms','pricing','login','signup','account'];
if (SITE_KEY) {
  const sites = JSON.parse(readFileSync(join(root, 'sites.json'), 'utf8'));
  site = sites[SITE_KEY];
  if (!site) { console.error(`SITE=${SITE_KEY} 는 sites.json에 없습니다`); process.exit(1); }
  siteSlugs = new Set([...site.categories.flatMap(c => CAT_SLUGS[c] || []), ...SUPPORT_SLUGS]);
}
const isToolDir = (name) => /-|calculator|count|compress|resize|convert|rotate|watermark|merge|split|extract|organize|sign|numbers|to-jpg|to-pdf/.test(name) && name !== 'assets';

const SKIP = new Set(['dist', 'scripts', 'node_modules', 'tests', '.git', 'supabase', 'portal', 'docs']);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
function copyFiltered(srcDir, dstDir, inKo) {
  for (const name of readdirSync(srcDir)) {
    if (!inKo && SKIP.has(name)) continue;
    const sp = join(srcDir, name), dp = join(dstDir, name);
    if (statSync(sp).isDirectory()) {
      // 툴 폴더이고 SITE 필터가 있으면 소속 카테고리만 복사 (ko도 동일 규칙)
      if (site && (inKo || name !== 'ko') && isToolDir(name) && !siteSlugs.has(name)) continue;
      mkdirSync(dp, { recursive: true });
      copyFiltered(sp, dp, inKo || name === 'ko');
    } else {
      cpSync(sp, dp);
    }
  }
}
copyFiltered(root, out, false);

/* 서브패스 배포(예: GitHub Pages …github.io/modutool) 지원.
   BASE_PATH='/modutool' 지정 시: ①정적 href/src 절대경로 앞에 접두 ②모듈 import·fetch·workerSrc의
   '/assets/…' 리터럴 접두 ③window.MDTL_BASE 주입(런타임 내비게이션은 site.js/auth.js가 이 값 사용).
   관례: DEPLOY_ORIGIN에는 base 경로까지 포함시킨다(canonical/sitemap은 __ORIGIN__만으로 완성). */
const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
if (base && !base.startsWith('/')) { console.error('BASE_PATH는 /로 시작해야 합니다'); process.exit(1); }

const pages = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.html')) continue;
    let html = readFileSync(p, 'utf8');
    html = html.replaceAll('__ORIGIN__', origin);
    if (site) {
      // 허브: 이 사이트 카테고리 섹션만 남김 (cat-title + 뒤따르는 tool-grid 쌍)
      if (name === 'index.html') {
        html = html.replace(/[ \t]*<div class="cat-title"[^>]*id="([a-z]+)"[^>]*>[\s\S]*?<\/div>\s*<div class="tool-grid">[\s\S]*?<\/div>\n/g,
          (m, id) => site.categories.includes(id) ? m : '');
      }
      // 브랜드 치환 + site.js용 전역 주입
      html = html.replaceAll('ThisIsMyPDF', site.brand);
      html = html.replace('<link rel="stylesheet"',
        `<script>window.MDTL_SITE_BRAND=${JSON.stringify(site.brand)};window.MDTL_SITE_MARK=${JSON.stringify(site.mark)};</script>\n<link rel="stylesheet"`);
    }
    if (base) {
      html = html.replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`);
      html = html.replaceAll("'/assets/", `'${base}/assets/`);
      html = html.replace('<link rel="stylesheet"', `<script>window.MDTL_BASE='${base}';</script>\n<link rel="stylesheet"`);
    }
    /* NOINDEX=1: 서브패스 브랜드 사이트(한 오리진 안 /img /calc)용 — 루트 허브와 툴 페이지가
       중복되므로 도메인 분리 전까지 검색 색인은 루트가 전담하고 서브사이트는 noindex. */
    if (process.env.NOINDEX && !/name="robots"/.test(html)) {
      html = html.replace('</head>', '<meta name="robots" content="noindex, follow">\n</head>');
    }
    writeFileSync(p, html);
    if (name === 'index.html' && !/noindex/.test(html)) {
      const rel = p.slice(out.length).replace(/\\/g, '/').replace(/index\.html$/, '');
      pages.push(origin + rel);
    }
  }
}
walk(out);

if (!process.env.NOINDEX) {
  writeFileSync(join(out, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    pages.sort().map(u => `  <url><loc>${u}</loc></url>`).join('\n') +
    '\n</urlset>\n');
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
}

console.log(`빌드 완료 → ${out} (색인 페이지 ${pages.length}개, origin=${origin})`);
