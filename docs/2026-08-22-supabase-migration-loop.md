# 2026-08-22 Supabase 이관 루프 (A′ — 대표 승인 "지금 이관")

근거: docs/2026-08-22-tripod-supabase-편입검토.md. 대상: Convex 백엔드 전체 → 공유 Supabase(wcztgneaqmwfeuonyjny) `tim_` 네임스페이스.
설계 결정: 엣지 함수 0개 — 공개 쓰기(텔레메트리·문의)는 anon 실행권한의 SECURITY DEFINER RPC 로, 검증·레이트리밋·롤업을 SQL 안에서 원자 처리.
Auth 는 1단계 이메일+비밀번호(Supabase Auth 기본), 구글 OAuth 는 대시보드 설정 필요라 T0 후속.
7월 Convex 이관 사유였던 "전용 무료 프로젝트 휴면→로그인 먹통"은 공유 상시활성 인스턴스에서 재발 불가.

## 백로그

| # | 항목 | 상태 | 커밋 |
|---|---|---|---|
| 1 | tim_ 스키마·RPC·RLS·트리거·pg_cron 마이그레이션 (프로필 자동생성 포함) | ✅ 완료 | 이 커밋 |
| 2 | 텔레메트리 스왑 — site.js 수집을 tim_log_event 로, 실삽입·롤업 검증 | ✅ 완료 | 이 커밋 |
| 3 | 문의 스왑 — contact 폼을 tim_submit_contact 로 (허니팟·레이트리밋 동등성) | 대기 | |
| 4 | Auth 스왑 — 로그인/가입/계정/삭제를 Supabase Auth 로 (구글 버튼은 플래그 숨김) | 대기 | |
| 5 | 백오피스 스왑 — tim_dashboard·문의 관리, admin 시드 | 대기 | |
| 6 | CI 전 게이트 + 라이브 스모크 + 헌장 backend:supabase + Convex 동결 기록 + T0 갱신 | 대기 | |

## 사이클 로그
- 13:1x 루프 등록(stockpilot 세션 인계 수행, DB 리스 선점). Convex 코드 742줄·프론트 접점 정독 완료.
- 14:0x [1] tim_ 마이그레이션 적용+스모크(화이트리스트 필터·롤업 증분·이메일 검증·크론 등록 실측, 스모크 데이터 정리). 엣지 함수 0개 설계 확정. Queue-Epoch: 1
- 14:3x [2] 텔레메트리 스왑 — MDTL_BACKEND 설정 도입(+전환기 MDTL_CONVEX 병존, 항목 3·4 완료 시 제거), site.js → rpc/tim_log_event. RPC 에 session_id/sessionId 양표기 호환 패치. anon 실전송 204 + tim_tool_events 적재·meta 화이트리스트 실측 후 스모크 정리(0행). 빌드 88페이지·unit 8단언 통과. Queue-Epoch: 1
