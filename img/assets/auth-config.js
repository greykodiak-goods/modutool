/* 백엔드 설정 — Convex 단일 백엔드 (2026-07-26 Supabase 완전 제거).
   deployment URL은 공개돼도 안전하다: 텔레메트리는 쓰기 전용 엔드포인트라 서버가 화이트리스트·
   크기를 검증하고 조회 함수 자체가 없으며, 회원 함수는 전부 서버측 인증(getAuthUserId)으로 막힌다.

   ⚠️ 현재 dev 배포(superb-echidna-510). 트래픽이 붙기 전에 prod 배포로 교체할 것 —
      dev 배포는 로컬에서 `convex dev`를 돌리면 함수가 덮어써진다.
      상세: docs/2026-07-26-namespace-plan.md 3절

   ※ 왜 Supabase를 뺐나: 무료 플랜 활성 프로젝트 2개 한도 때문에 thisismy-tools 프로젝트가
     반복적으로 INACTIVE가 되어 로그인이 실제로 먹통이 됐다(2026-07-26, 2회차). */
window.MDTL_CONVEX = {
  // 함수 호출은 .convex.cloud, HTTP action(/log-event, /api/auth/*)은 .convex.site 를 쓴다.
  // auth.js가 필요에 따라 호스트를 바꿔 붙이므로 여기엔 .convex.site 하나만 둔다.
  url: 'https://superb-echidna-510.convex.site'
};
