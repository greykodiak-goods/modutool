# 모두의툴 (tools-web) — 한국어 유틸리티 툴 사이트

설치·가입 없이 브라우저에서 쓰는 무료 도구 모음. **모든 파일 처리는 클라이언트 사이드**(pdf-lib, pdf.js, browser-image-compression, canvas)로, 서버가 없어 운영비 0원 + "파일이 서버로 전송되지 않음"이 핵심 차별점. 수익 모델은 광고(애드핏→애드센스) — 전략·근거는 `docs/2026-07-21-modutool-strategy.md`(전략)·`docs/2026-07-21-modutool-distribution.md`(노출 전략).

## 구성 (13개 툴 + 지원 페이지)

- PDF: 합치기(pdf-merge) · 나누기(pdf-split) · **페이지 삭제/순서변경/회전(pdf-organize, 리서치 1순위)** · PDF→JPG(pdf-to-jpg) · 이미지→PDF(img-to-pdf)
- 이미지: 압축(image-compress, **목표 KB 지정 지원**) · 크기조절/포맷변환(image-resize)
- 계산기: 만나이 · 퍼센트 · 글자수 · D-day · 삼각함수 · 평수
- 지원: index(허브) · about · privacy · terms · 404

## 개발 규칙

- 정적 HTML + 바닐라 JS, 빌드 프레임워크 없음. 공용은 `assets/site.css`(디자인 시스템)·`assets/site.js`(mdtl* 헬퍼) — **site.js는 defer 없이 로드**(인라인 툴 스크립트가 헬퍼를 즉시 사용).
- 새 툴 페이지는 `pdf-merge/index.html`을 구조 계약서로 복제: head 메타(canonical/og/JSON-LD는 `__ORIGIN__/<slug>/` 토큰) + 툴 UI + 가이드 500단어+ + FAQ 5개(본문=FAQPage JSON-LD 일치) + 관련도구 + 광고슬롯 2개.
- 외부 CDN 금지 — 벤더는 `assets/vendor/`의 로컬 파일만 (pdf-lib 1.17.1, pdf.js 6.1.200, browser-image-compression 2.0.2).
- ⚠️ pdf.js 6.x는 `Map.prototype.getOrInsertComputed`(신규 API)를 써서 Chromium ≤141 등에서 깨짐 — pdf.js 쓰는 페이지(pdf-to-jpg, pdf-organize)는 페이지 내 폴리필+blob 워커 패턴 필수(두 페이지 참고). 근본 해결은 legacy 빌드 교체(백로그).
- 광고: `assets/ads-config.js`에 ID를 넣기 전까지 슬롯이 DOM 공간을 차지하지 않음(CLS·승인정책 안전). 승인 후 이 파일만 수정하면 전 페이지 일괄 적용.

## 다국어 (ko 루트 + /en/)

- **IP 국가 기반 자동 리다이렉트 금지** — 구글봇이 미국에서 크롤하므로 SEO 안티패턴. 대신: 언어별 별도 URL(한국어=루트, 영어=`/en/…`) + 전 페이지 hreflang 3종(ko/en/x-default, x-default=en) + **브라우저 언어 감지 제안 배너**(site.js `mdtlLangBanner` — head의 hreflang alternate가 있을 때만 표시, 선택은 localStorage `mdtl-lang`).
- 셸(헤더/푸터)은 `<html lang>`으로 언어 판별해 site.js가 주입(ko=모두의툴, en=ModuTool). 새 언어 추가 시 site.js `LANGS`에 항목 추가 + 해당 언어 폴더 페이지 생성 + hreflang 갱신.
- 영어판 규칙: JS 로직·id·class는 한국어판과 동일 유지, 사용자 노출 문자열만 번역. title은 실제 영어 검색어 기준(예: "Korean Age Calculator", "Pyeong to Square Meters"). JSON-LD priceCurrency는 USD.
- 광고: 애드핏은 한국 전용 → 이후 ads-config에서 lang 분기(en은 애드센스만) 필요.

## 빌드·테스트·배포

```bash
# 빌드: __ORIGIN__ 치환 + sitemap.xml/robots.txt 생성 → dist/
node scripts/build.mjs https://실제도메인

# 로컬 확인
python3 -m http.server 8931 -d dist

# 테스트 (playwright+pdf-lib이 설치된 디렉토리 경로 필요)
node tests/structural.mjs http://localhost:8931 <pw설치경로>   # 전 페이지 구조 계약
node tests/smoke-pdf-merge.mjs http://localhost:8931 <pw설치경로>

# 배포: dist/를 아무 정적 호스팅에 (Netlify/Cloudflare Pages). netlify.toml 포함됨.
```

### Cloudflare Pages 설정 (권장 — main 푸시 = 자동배포)

대시보드 → Workers & Pages → Create → Pages → **Connect to Git** → `modutool` 선택 후:

| 항목 | 값 |
|---|---|
| Project name | `modutool` (→ modutool.pages.dev) |
| Production branch | `main` |
| Framework preset | None |
| Build command | `node scripts/build.mjs` |
| Build output directory | `dist` |
| 환경변수 | `DEPLOY_ORIGIN` = `https://modutool.pages.dev` |

커스텀 도메인 전환 시: Pages 프로젝트에 도메인 붙이고 `DEPLOY_ORIGIN`만 새 도메인으로 변경 → 재배포하면 canonical/hreflang/sitemap 전부 자동 갱신(pages.dev 버전은 canonical로 새 도메인을 가리켜 SEO가 자연 이관됨).
⚠️ 애드센스·애드핏 신청은 무료 서브도메인으론 불가 — 커스텀 도메인 연결 후에.

검증 이력(2026-07-21): 13개 툴 전부 Playwright 실동작 통과 — 실제 PDF 병합/분할/편집 결과물의 페이지수·회전각, 이미지 압축/리사이즈 결과물의 바이트 파싱(매직넘버·해상도), 계산기 수치의 수학 검증 포함. 구조 계약 테스트(메타/JSON-LD/분량/FAQ/외부스크립트 0) 전 페이지 통과.
