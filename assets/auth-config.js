/* 회원(로그인·프리미엄) 백엔드 설정 — Supabase 프로젝트 thisismy-tools (서울 ap-northeast-2)
   publishable key는 공개용 클라이언트 키다(RLS로 보호) — 브라우저 노출이 정상. service_role 키는 절대 넣지 말 것.
   스키마: supabase/migration_01_profiles.sql 적용됨 (2026-07-21). */
window.MDTL_AUTH = {
  url: 'https://gysvtgnpacqjpdijbcaw.supabase.co',
  anonKey: 'sb_publishable_pWcuYOmFtXdL6oL_68f4pg_-d__ocoT'
};

/* Convex 이관 — 텔레메트리 수집처. 이 URL이 설정되면 site.js가 Supabase 대신
   Convex HTTP action(/log-event)으로 보낸다. deployment URL은 공개돼도 안전(쓰기 전용 엔드포인트,
   서버가 화이트리스트·크기 검증, 조회 함수 자체가 없음).
   ⚠️ 현재 dev 배포(superb-echidna-510). 트래픽이 붙기 전에 prod 배포 키로 교체할 것 —
      dev 배포는 로컬에서 `convex dev`를 돌리면 함수가 덮어써질 수 있다. */
window.MDTL_CONVEX = { url: 'https://superb-echidna-510.convex.site' };
