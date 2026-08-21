# Cloudflare 정본 전환 런북 — 도메인 구매 직후 그대로 실행

대표 결정(2026-08-21): 정본 = 커스텀 도메인 + Cloudflare Pages. 이 문서는 **대표가 도메인을
구매한 순간부터** 무엇을 누가 하는지의 실행 순서다. `_headers`(보안·캐시 헤더)는 빌드에 이미
포함되어 있어 연결만 하면 적용된다.

## 대표(T0) — 총 10~15분

1. **도메인 구매**: thisismypdf.com (Cloudflare Registrar 권장 — 원가 판매·이관 불필요).
2. **Pages 프로젝트 연결**: dash.cloudflare.com → Workers & Pages → Create → Pages →
   **Connect to Git** → `greykodiak-goods/modutool` 선택 후 README 표 그대로:
   - Project name `thisismypdf` / Production branch `main` / Build `node scripts/build.mjs` / Output `dist`
   - 환경변수 `DEPLOY_ORIGIN` = 발급된 주소(초기엔 `https://thisismypdf.pages.dev`)
3. **커스텀 도메인 연결**: Pages 프로젝트 → Custom domains → thisismypdf.com 추가(DNS 자동).
4. 완료를 알려주면 이후는 전부 위임.

## 총괄(T1) — 대표 완료 통보 후

1. `DEPLOY_ORIGIN`을 `https://thisismypdf.com`으로 변경 요청(env 변경은 대시보드라 대표 클릭 1회)
   → 재배포로 canonical/hreflang/sitemap 전부 새 도메인 재생성.
2. 검증: live-check를 `-f base_url=https://thisismypdf.com`로 실행 + curl로 canonical 대조.
3. **SEO 이관**: gh-pages 쪽은 유지하되 canonical이 새 도메인을 가리키므로 자연 이관.
   Search Console에 도메인 속성 추가(DNS 인증 — Cloudflare라 TXT 1개) + sitemap 제출.
4. gh-pages 배포 절차를 Cloudflare 자동배포(main 푸시=배포)로 대체 — ci.yml green 후 merge가 곧 배포.
   live-check 기본 URL을 새 도메인으로 변경.
5. 안정 확인(48h) 후: AdSense 신청(대표 T0), Convex prod 전환과 함께 구글 OAuth 리다이렉트에
   새 도메인 추가.

## 주의

- `modutool.pages.dev`는 타인이 선점 — 프로젝트명은 `thisismypdf`로.
- 무료 서브도메인(pages.dev)으로는 AdSense 불가 — 커스텀 도메인 연결이 선행.
- 전환 후에도 offline 번들·Netlify 경로는 영향 없음(오리진 주입식 빌드).
