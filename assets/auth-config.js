/* 백엔드 설정 — Supabase 공유 인스턴스 (2026-08-22 Convex→Supabase 재이관, A′).
   근거: docs/2026-08-22-tripod-supabase-편입검토.md — 계정 0명인 "무통 창"에 이관,
   조직 표준 1-DB(관제·백업 단일화)·SQL 전수 집계. 7월 Convex 이관 사유였던
   "무료 전용 프로젝트 휴면→로그인 먹통"은 상시 활성 공유 인스턴스라 재발하지 않는다.

   key(publishable)는 공개 전제 키다: 텔레메트리·문의는 서버(RPC)가 화이트리스트·크기·
   레이트리밋을 강제하는 쓰기 전용이고, 조회·회원 RPC 는 전부 서버측 인증(auth.uid)으로 막힌다.
   테이블 직접 접근은 RLS 로 전면 차단 — 접근 면은 RPC 목록이 전부다. */
window.MDTL_BACKEND = {
  url: 'https://wcztgneaqmwfeuonyjny.supabase.co',
  key: 'sb_publishable_IfQ3mKVFiauD9PsMbT1q9A_1lMIxIGk',
  google: false // 구글 OAuth 는 Supabase 대시보드 공급자 설정(T0) 후 true 로 — 그전까지 버튼 숨김
};

/* [전환기 한정] auth.js·contact 가 Supabase 로 스왑되는 이관 항목 4·3 완료 시 삭제.
   그전까지 로그인·문의는 기존 Convex 경로를 유지해 커밋 단위로 배포 가능하게 한다. */
window.MDTL_CONVEX = { url: 'https://superb-echidna-510.convex.site' };
