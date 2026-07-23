# Convex 이관 준비 (2026-07-23, 대표 지시)

> 대상: modutool(ThisIsMy Tools)의 백엔드 Supabase 프로젝트 `gysvtgnpacqjpdijbcaw` (thisismy-tools).
> 상태: **이관 준비 완료** — 스키마·함수 스캐폴드가 `convex/`에 커밋됨. 실제 프로비저닝은 Convex 계정 필요(아래 "대표가 하는 것").

## 현행 Supabase 자산 → Convex 매핑

| Supabase | 역할 | Convex 대응 (스캐폴드 완료) |
|---|---|---|
| `tool_events` 테이블 + INSERT-only RLS | 익명 결과 텔레메트리 | `toolEvents` 테이블 + `telemetry.logEvent`(internal mutation, 화이트리스트·크기 검증 동일) + `http.ts` `/log-event` HTTP action(브라우저 fetch 수신, CORS 오리진 화이트리스트). **클라이언트 조회 함수 자체가 없음** = RLS 조회차단과 동등 |
| `mdtl_tool_dashboard(days)` RPC + `admin_users` | 관리자 백오피스 집계 | `dashboard.dashboard` query + `adminUsers` 테이블 — `ctx.auth` 이메일을 adminUsers 인덱스로 대조. 반환 JSON 형태를 기존 `/admin/` 페이지와 동일하게 맞춤(프론트 수정 최소화) |
| `auth.users` + `profiles` + trigger | 회원/플랜 | `profiles` 테이블. 인증은 **Convex Auth**(비밀번호+Google OAuth 지원)로 대체 예정 — 아래 "인증 이관" 참조 |
| Storage | (미사용) | 해당 없음 |

## 데이터 이관량 — 사실상 제로

- `tool_events`: 8행 전부 시드/CI 테스트 데이터(`meta.seed=true`) → **이관 불필요, 새로 시작**.
- 회원: 1명(대표 계정, 세션이 직접 생성) → 재생성이 이관보다 쉬움.
- 즉 **데이터 마이그레이션 리스크 없음. 스위치는 코드 전환만으로 완료**되는 단계에서 준비됨.

## 인증 이관 (설계 결정 필요 지점)

- Supabase Auth의 비밀번호 해시(bcrypt)는 Convex Auth(Scrypt)로 **직접 이식 불가**. 현재 실사용자 1명이므로 재가입/비밀번호 재설정으로 처리(무손실).
- Convex Auth 구성: Password provider + Google OAuth. Google 자격증명은 Supabase용으로 만들려던 것과 동일한 Google Cloud OAuth 클라이언트를 재사용하되 **리디렉션 URI만 Convex 콜백으로 교체**.
- 무빌드 정적 사이트 제약: Convex Auth는 npm 클라이언트가 표준이라, `assets/vendor/`에 브라우저 번들을 벤더링하는 작업이 프로비저닝 후 1회 필요(현 supabase.js 벤더링과 동일 패턴).

## 프론트 전환 지점 (프로비저닝 후 내가 수행)

1. `assets/site.js` 텔레메트리 fetch URL: Supabase REST → `https://<deployment>.convex.site/log-event` (페이로드 형식 유지 — HTTP action이 기존 snake_case 그대로 수신).
2. `/admin/` 페이지: `sb.rpc('mdtl_tool_dashboard')` → Convex client `query(api.dashboard.dashboard)` (반환 JSON 동일 구조라 렌더 코드 재사용).
3. `login/signup/account`: Supabase SDK → Convex Auth 클라이언트로 교체(가장 큰 작업, 페이지 4×2개 언어).
4. `assets/auth-config.js` → `convex-config.js`(deployment URL만 노출 — 공개 안전).

## 컷오버 절차 (다운타임 없음)

1. 대표: Convex 계정·프로젝트 생성 → deploy key 전달(또는 `npx convex dev` 1회 로그인).
2. 나: `npx convex deploy`로 스키마·함수 배포 → adminUsers에 대표 이메일 시드 → HTTP action 검증(curl 201/400/CORS).
3. 나: 텔레메트리 URL 스위치 배포(이 시점부터 신규 이벤트는 Convex로). Supabase는 읽기전용 보존.
4. 나: Convex Auth 벤더링 + 회원 페이지 4종 전환 → 대표 계정 재생성 → /admin Convex 쿼리 전환.
5. 검증 2주 후 Supabase 프로젝트 pause(비용 0, 롤백 보험).

## 대표가 하는 것 (5분)

1. https://convex.dev 가입(GitHub 계정 연동이 가장 빠름) → 프로젝트 생성(이름: thisismy-tools).
2. Settings → **Deploy key 생성해서 전달** (또는 개발 세션에서 `npx convex login`).
3. (인증 단계에서) Google Cloud OAuth 클라이언트의 승인된 리디렉션 URI에 Convex 콜백 추가.

## 왜 Convex가 이 프로젝트에 맞나 (참고)

- 텔레메트리 검증 로직이 SQL CHECK가 아니라 **TypeScript 함수**라 화이트리스트를 site.js와 문자 그대로 공유 가능(드리프트 방지).
- 백오피스가 reactive query라 새 실패 이벤트가 **실시간 반영**(현재는 새로고침 필요).
- 무료 티어가 이 트래픽 규모에 충분, 콜드스타트 없음.
- 유의: 무빌드 정적 사이트와의 궁합은 Supabase(REST 직접 호출)보다 한 단계 번거로움 — HTTP action으로 해소(텔레메트리는 이미 해소, 인증만 벤더링 필요).
