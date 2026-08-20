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
import { createHash } from 'node:crypto';

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
  image: ['image-compress','image-resize','image-crop','image-convert','image-rotate','image-watermark','img-to-pdf','image-redact','image-exif','image-split','image-color-picker','image-bg-remove','image-object-remove'],
  calc: ['age-calculator','percent-calculator','char-count','dday-calculator','trig-calculator','pyeong-calculator','vat-calculator','interest-calculator','unit-converter'],
  util: ['qr-generator','password-generator','text-diff'],
  video: ['video-trim','video-to-mp3','video-to-gif','video-compress','audio-trim'],
};
const SUPPORT_SLUGS = ['about','privacy','terms','pricing','login','signup','account','contact'];
if (SITE_KEY) {
  const sites = JSON.parse(readFileSync(join(root, 'sites.json'), 'utf8'));
  site = sites[SITE_KEY];
  if (!site) { console.error(`SITE=${SITE_KEY} 는 sites.json에 없습니다`); process.exit(1); }
  siteSlugs = new Set([...site.categories.flatMap(c => CAT_SLUGS[c] || []), ...SUPPORT_SLUGS]);
}
/* ── OFFLINE=1 : 사내 자체호스팅용 번들 ──
   외부로 나가는 통신을 0으로 만든 사본을 만든다. 이걸 원하는 곳이 실재한다 —
   법무법인·병원·공공기관은 계약서·진료기록을 iLovePDF류에 올리는 것이 규정상 불가능하다.
   우리 도구는 원래 클라이언트 처리라, 회원·수집·광고만 떼면 그대로 폐쇄망에서 돈다.

   떼는 것: 텔레메트리(수집 대상 없음) · 광고 · 로그인/가입/계정/백오피스(백엔드 없음).
   남는 것: 도구 전체. 검색 색인은 당연히 하지 않는다(내부망). */
const OFFLINE = !!process.env.OFFLINE;

const isToolDir = (name) => /-|calculator|count|compress|resize|convert|rotate|watermark|merge|split|extract|organize|sign|numbers|to-jpg|to-pdf/.test(name) && name !== 'assets';

const SKIP = new Set(['dist', 'scripts', 'node_modules', 'tests', '.git', 'supabase', 'portal', 'docs', 'convex']);

/* 레포 루트에 있는 "파일"은 이 목록에 있는 것만 배포한다 — 나머지는 전부 개발용이다.
   ⚠️ SKIP처럼 "빼는 것을 나열"하면 새 파일이 생길 때마다 조용히 새어나간다. 실제로 README.md
      (수익 모델·내부 문서 경로가 적혀 있다)와 netlify.toml, sites.json이 공개 사이트에
      배포되고 있었다(2026-07-26 발견, .github 유출과 같은 계열의 두 번째 사고).
      그래서 루트만은 "넣을 것을 나열"하는 방식으로 뒤집는다. 하위 폴더는 웹 자산뿐이라 무관. */
const ROOT_FILES_ALLOW = new Set(['index.html', '404.html', 'sw.js', 'robots.txt']);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
function copyFiltered(srcDir, dstDir, inKo) {
  for (const name of readdirSync(srcDir)) {
    /* 점으로 시작하는 항목은 전부 제외. SKIP은 이름을 하나씩 나열하는 방식이라
       새 점파일이 생길 때마다 조용히 새어나간다 — 실제로 .github/workflows/*.yml 과
       .gitignore 가 공개 사이트로 배포되고 있었다(2026-07-26 발견).
       시크릿 "값"은 워크플로에 없지만(secrets.X 참조뿐) 내부 CI 구성이 노출될 이유가 없다.
       이름 나열이 아니라 규칙으로 막는다. (.nojekyll은 배포 스크립트가 따로 만든다) */
    if (name.startsWith('.')) continue;
    if (!inKo && SKIP.has(name)) continue;
    const sp = join(srcDir, name), dp = join(dstDir, name);
    // 루트 파일은 허용목록 방식(위 ROOT_FILES_ALLOW 주석 참고)
    if (srcDir === root && statSync(sp).isFile() && !ROOT_FILES_ALLOW.has(name)) continue;
    if (statSync(sp).isDirectory()) {
      // 툴 폴더이고 SITE 필터가 있으면 소속 카테고리만 복사 (ko도 동일 규칙)
      if (site && (inKo || name !== 'ko') && isToolDir(name) && !siteSlugs.has(name)) continue;
      // ffmpeg(31MB)는 영상 도구 전용 — SITE 빌드에서 video 외 사이트엔 미포함
      if (name === 'ffmpeg' && SITE_KEY && SITE_KEY !== 'video') continue;
      mkdirSync(dp, { recursive: true });
      copyFiltered(sp, dp, inKo || name === 'ko');
    } else {
      // opencv.js(13MB)는 이미지 도구 전용 — SITE 빌드에서 img 외 사이트엔 미포함
      if (name === 'opencv.js' && SITE_KEY && SITE_KEY !== 'img') continue;
      cpSync(sp, dp);
    }
  }
}
copyFiltered(root, out, false);

if (OFFLINE) {
  /* 백엔드가 없는 배포이므로 백엔드에 의존하는 화면을 아예 빼야 한다.
     남겨두면 "로그인이 안 된다"는 문의만 만든다. */
  for (const slug of ['login', 'signup', 'account', 'admin', 'pricing', 'contact']) {
    rmSync(join(out, slug), { recursive: true, force: true });
    rmSync(join(out, 'ko', slug), { recursive: true, force: true });
  }
  // 설정을 비워 수집·광고 코드가 실행 자체를 하지 않게 한다(코드에 남아 있어도 호출 조건이 없음).
  writeFileSync(join(out, 'assets/auth-config.js'),
    '/* 자체호스팅 번들: 외부 백엔드 없음. 수집·회원 기능 비활성. */\n');
  writeFileSync(join(out, 'assets/ads-config.js'),
    '/* 자체호스팅 번들: 광고 없음. */\n');
  rmSync(join(out, 'assets/vendor/convex.js'), { force: true });
}

/* 서브패스 배포(예: GitHub Pages …github.io/modutool) 지원.
   BASE_PATH='/modutool' 지정 시: ①정적 href/src 절대경로 앞에 접두 ②모듈 import·fetch·workerSrc의
   '/assets/…' 리터럴 접두 ③window.MDTL_BASE 주입(런타임 내비게이션은 site.js/auth.js가 이 값 사용).
   관례: DEPLOY_ORIGIN에는 base 경로까지 포함시킨다(canonical/sitemap은 __ORIGIN__만으로 완성). */
const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
if (base && !base.startsWith('/')) { console.error('BASE_PATH는 /로 시작해야 합니다'); process.exit(1); }

/* ── PWA(오프라인) 자산 ──
   전 도구가 클라이언트 처리라, 서비스워커만 붙으면 인터넷 없이도 동작한다(업로드형 경쟁 사이트는 원리상 불가).
   빌드ID는 셸 자산 내용 해시 — 내용이 안 바뀌면 같은 ID라 캐시가 유지되고, 바뀌면 새 캐시로 갈아탄다. */
const brandName = site ? site.brand : 'ThisIsMy Tools';
const brandMark = site ? site.mark : 'T';
const brandDesc = site ? site.tagline : 'Free in-browser tools — your files never leave your device';
const shellSrc = ['assets/site.js', 'assets/site.css', 'sw.js']
  .map((f) => { try { return readFileSync(join(out, f), 'utf8'); } catch { return ''; } }).join('\n');
const buildId = process.env.BUILD_ID ||
  createHash('sha256').update(shellSrc + '|' + base + '|' + origin).digest('hex').slice(0, 12);

try {
  writeFileSync(join(out, 'sw.js'), readFileSync(join(out, 'sw.js'), 'utf8').replaceAll('__BUILD_ID__', buildId));
} catch { /* sw.js가 없는 빌드(포털 등)는 건너뜀 */ }

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
  `<rect width="100" height="100" rx="22" fill="#2563eb"/>` +
  `<text x="50" y="68" font-size="52" text-anchor="middle" fill="#fff" font-family="sans-serif" font-weight="bold">${brandMark}</text></svg>\n`;
writeFileSync(join(out, 'icon.svg'), iconSvg);
writeFileSync(join(out, 'manifest.webmanifest'), JSON.stringify({
  name: brandName,
  short_name: brandName,
  description: brandDesc,
  start_url: (base || '') + '/',
  scope: (base || '') + '/',
  display: 'standalone',
  background_color: '#f7f8fa',
  theme_color: '#2563eb',
  icons: [{ src: (base || '') + '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}, null, 2) + '\n');

if (OFFLINE) {
  /* 받는 쪽은 우리 사정을 모르는 IT 담당자다. 설치 방법과 "무엇을 확인하면 되는지"를 같이 준다.
     보안 검토를 통과해야 쓸 수 있는 조직이 대상이므로, 검증 방법을 먼저 적는다. */
  writeFileSync(join(out, 'README.txt'),
`${brandName} — 사내 자체호스팅 배포판

■ 이게 뭔가
  브라우저 안에서만 동작하는 문서·이미지 도구 모음입니다.
  파일 처리가 전부 사용자 PC의 브라우저에서 일어나므로, 문서가 어디로도 전송되지 않습니다.

■ 설치
  1. 이 폴더 전체를 사내 웹서버의 원하는 경로에 복사합니다.
  2. 정적 파일 서빙만 하면 됩니다 — 별도 런타임·DB·백엔드가 필요 없습니다.
     (Nginx, Apache, IIS, 사내 파일서버 모두 가능)
  3. 브라우저에서 해당 경로를 엽니다. 끝입니다.

  ※ HTTPS 권장: 오프라인 캐시(서비스워커)는 보안 컨텍스트에서만 동작합니다.
     http://localhost 는 예외적으로 허용됩니다.

■ 보안 검토 시 확인하실 것
  · 외부 통신: 브라우저 개발자도구 → 네트워크 탭을 열고 도구를 사용해 보십시오.
    이 서버 외의 요청이 0건이어야 정상입니다. (배포 전 자동 검증 항목입니다)
  · 소스: 전부 정적 파일입니다. 난독화하지 않았으므로 그대로 읽으실 수 있습니다.
  · 수집·광고·외부 계정 연동: 이 배포판에는 포함돼 있지 않습니다.
  · 반출 경로: 파일 입력은 <input type=file>, 출력은 브라우저 다운로드뿐입니다.

■ 오프라인 동작
  한 번 연 뒤에는 네트워크가 끊겨도 동작합니다(서비스워커 캐시).
  폐쇄망·현장 노트북에서도 그대로 쓰실 수 있습니다.

■ 브라우저 요구사항
  Chrome / Edge / Firefox / Safari 최신 버전.
  처리는 사용자 PC 자원을 사용하므로, 대용량 파일은 사양에 영향을 받습니다.

■ 포함된 도구
${readdirSync(out).filter((n) => { try { return statSync(join(out, n)).isDirectory() && n !== 'assets' && n !== 'ko'; } catch { return false; } }).sort().map((n) => '  · ' + n).join('\n')}

■ 문의
  이 배포판을 제공한 담당자에게 연락하십시오.
`);

  /* 푸터가 삭제된 페이지를 가리키면 죽은 링크가 된다. 있는 것만 남긴다. */
  const sp = join(out, 'assets/site.js');
  let js = readFileSync(sp, 'utf8');
  js = js.replace(/\[\'\/ko\/pricing\/\', \'프리미엄\'\], /, '')
         .replace(/\[\'\/ko\/contact\/\', \'문의\'\], /, '')
         .replace(/\[\'\/pricing\/\', \'Premium\'\], /, '')
         .replace(/\[\'\/contact\/\', \'Contact\'\], /, '');
  writeFileSync(sp, js);
}

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
        // \r?\n — 윈도 체크아웃(autocrlf)은 CRLF라 \n 고정이면 필터가 통째로 무력화된다(2026-08-21 실사고)
        html = html.replace(/[ \t]*<div class="cat-title"[^>]*id="([a-z]+)"[^>]*>[\s\S]*?<\/div>\s*<div class="tool-grid">[\s\S]*?<\/div>\r?\n/g,
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
    /* PWA 매니페스트 링크 — base 치환 뒤에 넣어 이중 접두를 피한다 */
    html = html.replace('<link rel="stylesheet"',
      `<link rel="manifest" href="${base}/manifest.webmanifest">\n<link rel="stylesheet"`);
    /* NOINDEX=1: 서브패스 브랜드 사이트(한 오리진 안 /img /calc)용 — 루트 허브와 툴 페이지가
       중복되므로 도메인 분리 전까지 검색 색인은 루트가 전담하고 서브사이트는 noindex. */
    if ((process.env.NOINDEX || OFFLINE) && !/name="robots"/.test(html)) {
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

if (!process.env.NOINDEX && !OFFLINE) {
  writeFileSync(join(out, 'sitemap.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    pages.sort().map(u => `  <url><loc>${u}</loc></url>`).join('\n') +
    '\n</urlset>\n');
  writeFileSync(join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
}

console.log(`빌드 완료 → ${out} (색인 페이지 ${pages.length}개, origin=${origin})`);
