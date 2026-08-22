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
| 3 | 문의 스왑 — contact 폼을 tim_submit_contact 로 (허니팟·레이트리밋 동등성) | ✅ 완료 | 이 커밋 |
| 4 | Auth 스왑 — 로그인/가입/계정/삭제를 Supabase Auth 로 (구글 버튼은 플래그 숨김) | ✅ 완료 | 이 커밋 |
| 5 | 백오피스 스왑 — tim_dashboard·문의 관리, admin 시드 | ✅ 완료 | 이 커밋 |
| 6 | CI 전 게이트 + 라이브 스모크 + 헌장 backend:supabase + Convex 동결 기록 + T0 갱신 | ✅ 완료 | 이 커밋 + gh-pages |

## 사이클 로그
- 13:1x 루프 등록(stockpilot 세션 인계 수행, DB 리스 선점). Convex 코드 742줄·프론트 접점 정독 완료.
- 14:0x [1] tim_ 마이그레이션 적용+스모크(화이트리스트 필터·롤업 증분·이메일 검증·크론 등록 실측, 스모크 데이터 정리). 엣지 함수 0개 설계 확정. Queue-Epoch: 1
- 14:3x [2] 텔레메트리 스왑 — MDTL_BACKEND 설정 도입(+전환기 MDTL_CONVEX 병존, 항목 3·4 완료 시 제거), site.js → rpc/tim_log_event. RPC 에 session_id/sessionId 양표기 호환 패치. anon 실전송 204 + tim_tool_events 적재·meta 화이트리스트 실측 후 스모크 정리(0행). 빌드 88페이지·unit 8단언 통과. Queue-Epoch: 1
- 14:5x [3] 문의 스왑 — en·ko contact 폼을 rpc/tim_submit_contact 로. 레이트리밋 판정은 429 상태코드 → {ok:false,code:'rate_limited'} JSON 으로 교체. anon 실호출 4케이스 실측: 정상 ok:true 적재, 허니팟 ok:true 무적재(0행), 빈 제목 code:'empty'→오류 분기, 21연타 시 21번째 rate_limited(분당 20 상한 정확). 스모크 정리(msgs·rate 0행). Queue-Epoch: 1
- 15:1x [4] Auth 스왑 — auth.js 를 Supabase Auth REST 로 전면 재작성(벤더 0). window.mdtl* 계약 유지, Convex 함수명은 RPC_MAP 번역(account:me→tim_me 등), signOutEverywhere→logout?scope=global, 구글은 PKCE 구현 + google:false 플래그 거부. vendor/convex.js·convex-entry.js 삭제, 회원 페이지 7곳 벤더 태그 제거, 전환기 MDTL_CONVEX 제거(참조 0 확인). 실측 8단계: 로그인 200/리프레시 회전/ensure_profile created/me 형상일치/전기기 로그아웃 204/로그아웃 후 리프레시 400 거부/삭제 오입력 email_mismatch/정상삭제 ok — 계정·프로필 실삭제 DB 대조(0행). **발견: 이메일 확인(confirm)이 켜져 있음** → 가입 직후 세션 없음. 프런트는 confirm_email_required 분기로 "확인 메일" 안내 처리(en·ko). Queue-Epoch: 1

> **[T0 대기] Supabase Auth 이메일 확인 설정**: 공유 인스턴스 전체에 걸리는 Auth 설정이라 대표 결정 필요.
> 선택지 ⓐ Confirm email OFF(가입 즉시 로그인, 지금 프런트도 자동 대응) ⓑ ON 유지 + 커스텀 SMTP 연결(기본 메일러는 시간당 수 통 제한이라 운영 불가). 현재 프런트는 어느 쪽이든 동작.

- 15:4x [5] 백오피스 스왑 — RPC_MAP 은 [4]에서 선반영, 이번엔 admin 페이지 문구 2곳(Convex 시드 안내→tim_admin_users, 결정대기 라벨) 갱신 + **admin 시드: greykodiak1@gmail.com 등록**. 임시 관리자 계정으로 실측 8단계: dashboard 15키 전부 존재·집계 실값 일치(도구 2건 중 실패 1, 페이지뷰 1 분리집계), contact_list 키 8종 렌더 계약 일치, setHandled 왕복, anon 호출 forbidden 차단, 임시계정 자삭. 스모크·임시시드 전량 정리(admins 1행=대표만, 나머지 0행). Queue-Epoch: 1
- 16:2x [6] 마감 — 헌장 backend:supabase. convex/ 코드·convex-deploy.yml·vendor 전부 삭제(git 이력 보존), doppler 필수키 CONVEX_DEPLOY_KEY 해제. SQL 정본을 운영 DB 덤프로 리포 기록(supabase/migrations/, contract-audit ③이 이 파일과 events.yaml 을 대조하도록 재배선). 구 convex/lib 단위테스트 2종 → backend-sql-unit(17단언, 같은 불변식을 SQL 정본에서 검증)으로 대체. auth-func 14시나리오·supabase-switch·contact-func·telemetry.spec 재작성, live-check 백엔드 섹션 Supabase 재작성. 로컬 게이트 전부 green(unit 17·coverage·contract·i18n·offline·umbrella/subsites/admin/pages smoke·structural·pdf-merge). Queue-Epoch: 1

## 남은 T0 (대표 결정 대기)
1. **Auth 이메일 확인 설정** — ⓐ Confirm email OFF ⓑ ON+커스텀 SMTP. 현재 프런트는 양쪽 다 대응(위 [4] 참조).
2. **Convex dev 배포(superb-echidna-510) 폐기** — 코드·데이터 이관 완료로 더 안 쓰나, 삭제는 파괴적이라 대표 클릭. 급하지 않음(무료·방치 무해).
3. (기존) 도메인 구매·Cloudflare 연결 — docs/2026-08-22-cloudflare-cutover.md.
4. (기존) 구글 OAuth 공급자 설정 — 설정 후 auth-config `google: true` 로 전환.
