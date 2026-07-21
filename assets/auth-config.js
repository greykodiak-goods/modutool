/* 회원(로그인·프리미엄) 백엔드 설정 — Supabase 프로젝트가 준비되면 아래 주석을 풀고 값만 채우면
   전 페이지에서 회원 기능이 일괄 활성화된다. 비어 있으면 로그인 버튼·회원 기능이 표시되지 않는다.
   (anon key는 공개용 키 — RLS로 보호되므로 클라이언트 노출이 정상이다. service_role 키는 절대 넣지 말 것.)

   window.MDTL_AUTH = {
     url: 'https://xxxxxxxxxxxx.supabase.co',
     anonKey: 'sb_publishable_...'
   };

   선행 조건: supabase/migration_01_profiles.sql 을 해당 프로젝트에 적용할 것.
*/
