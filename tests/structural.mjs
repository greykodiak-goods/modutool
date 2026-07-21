/* 전 페이지 구조 검증 — 구현 세부와 무관한 공통 계약 체크
   사용: node tests/structural.mjs <baseURL> <playwright설치경로> */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const base = process.argv[2] || 'http://localhost:8931';
const pwDir = process.argv[3];
const require = createRequire(join(pwDir, 'package.json'));
const { chromium } = require('playwright');

const TOOL_SLUGS = [
  'pdf-merge', 'pdf-split', 'pdf-organize', 'pdf-rotate', 'pdf-extract', 'pdf-compress', 'pdf-watermark', 'pdf-page-numbers', 'pdf-sign', 'pdf-to-jpg', 'img-to-pdf',
  'image-compress', 'image-resize', 'image-crop', 'image-convert', 'image-rotate', 'image-watermark',
  'age-calculator', 'percent-calculator', 'char-count',
  'dday-calculator', 'trig-calculator', 'pyeong-calculator',
];
const TOOL_PAGES = [...TOOL_SLUGS, 'ko', ...TOOL_SLUGS.map(s => 'ko/' + s)];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
let failures = [];

function check(slug, cond, msg) {
  if (!cond) failures.push(`[${slug}] ${msg}`);
}

for (const slug of ['', ...TOOL_PAGES]) {
  const errors = [];
  const onErr = (e) => errors.push(e.message);
  page.on('pageerror', onErr);
  const url = base + '/' + (slug ? slug + '/' : '');
  const resp = await page.goto(url, { waitUntil: 'networkidle' }).catch(() => null);
  if (!resp || resp.status() !== 200) { failures.push(`[${slug || 'index'}] 로드 실패`); page.off('pageerror', onErr); continue; }

  const info = await page.evaluate(() => {
    const jsonlds = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => {
      try { JSON.parse(s.textContent); return true; } catch { return false; }
    });
    const guideText = document.querySelector('.guide')?.textContent || '';
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || '',
      canonical: document.querySelector('link[rel=canonical]')?.href || '',
      desc: document.querySelector('meta[name=description]')?.content || '',
      jsonldCount: jsonlds.length,
      jsonldOk: jsonlds.every(Boolean),
      faqCount: document.querySelectorAll('.faq details').length,
      guideWords: guideText.split(/\s+/).filter(Boolean).length,
      headerOk: !!document.querySelector('#site-header .logo'),
      footerOk: !!document.querySelector('#site-footer a[href$="privacy/"]'),
      hreflangs: [...document.querySelectorAll('link[rel=alternate][hreflang]')].map(l => l.getAttribute('hreflang')).sort().join(','),
      activeAds: document.querySelectorAll('.ad-slot.active').length,
      hasViewport: !!document.querySelector('meta[name=viewport]'),
      lang: document.documentElement.lang,
      externalScripts: [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => !s.startsWith(location.origin)),
    };
  });

  const name = slug || 'index';
  const isKo = slug === 'ko' || slug.startsWith('ko/');
  const isHub = slug === '' || slug === 'ko';
  check(name, errors.length === 0, 'JS 오류: ' + errors.join(' | '));
  check(name, info.title.includes('ThisIsMyPDF'), 'title에 사이트명 없음: ' + info.title);
  check(name, info.h1.length >= 2, 'h1 없음');
  check(name, info.desc.length >= 50, 'description 부족: ' + info.desc.length);
  check(name, info.canonical.includes('/' + (slug ? slug + '/' : '')), 'canonical 불일치: ' + info.canonical);
  check(name, info.jsonldOk, 'JSON-LD 파싱 실패');
  check(name, info.headerOk && info.footerOk, '헤더/푸터 주입 실패');
  check(name, info.activeAds === 0, '광고 설정 없는데 활성 슬롯 존재');
  check(name, info.hasViewport && info.lang === (isKo ? 'ko' : 'en'), 'viewport/lang 누락: ' + info.lang);
  check(name, info.externalScripts.length === 0, '외부 스크립트 발견: ' + info.externalScripts.join(','));
  check(name, info.hreflangs === 'en,ko,x-default', 'hreflang 3종 불일치: ' + info.hreflangs);
  if (!isHub) {
    check(name, info.jsonldCount >= 2, 'JSON-LD 2개(WebApp+FAQ) 미만: ' + info.jsonldCount);
    check(name, info.faqCount >= 4, 'FAQ 부족: ' + info.faqCount);
    check(name, info.guideWords >= 220, '가이드 분량 부족(어절 ' + info.guideWords + ')');
  }
  page.off('pageerror', onErr);
}

await browser.close();
if (failures.length) {
  console.error('❌ 구조 검증 실패 ' + failures.length + '건:');
  failures.forEach(f => console.error('  ' + f));
  process.exit(1);
}
console.log('✅ 구조 검증 통과 — 허브 + 툴 ' + TOOL_PAGES.length + '페이지 전부 OK');
