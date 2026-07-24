/* 회원(로그인·프리미엄) 백엔드 설정 — Supabase 프로젝트 thisismy-tools (서울 ap-northeast-2)
   publishable key는 공개용 클라이언트 키다(RLS로 보호) — 브라우저 노출이 정상. service_role 키는 절대 넣지 말 것.
   스키마: supabase/migration_01_profiles.sql 적용됨 (2026-07-21). */
window.MDTL_AUTH = {
  url: 'https://gysvtgnpacqjpdijbcaw.supabase.co',
  anonKey: 'sb_publishable_pWcuYOmFtXdL6oL_68f4pg_-d__ocoT'
};

/* Convex 이관 스위치 — 프로비저닝 후 deployment의 .convex.site URL을 넣으면
   텔레메트리가 즉시 Convex로 전환된다(사이트 재배포만, 페이지 수정 없음).
   예: window.MDTL_CONVEX = { url: 'https://something-123.convex.site' }; */
window.MDTL_CONVEX = null;
