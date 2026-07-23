# 로그인·가입 + 구글 OAuth + 보안·세션 관리 (2026-07-21)

> 대표 지시: 로그인·가입 2개 페이지, 구글로 가입/로그인, 기존 아이디·비밀번호·개인정보 법 준수, 세션관리.

## 구현 완료 (코드로 끝난 것)

- **로그인/가입 분리 페이지**: `/login/` `/signup/` (+ `/ko/…`). 로그인=이메일+비밀번호 / 매직링크(비번 없이 이메일). 가입=이메일+비밀번호(8자+)+약관 동의+이메일 확인.
- **구글로 계속하기 버튼**: 로그인·가입 4개 페이지에 추가. 클릭 시 `supabase.auth.signInWithOAuth({provider:'google'})` → 구글 로그인 후 `/account/`로 복귀. 로그인·가입이 같은 버튼(계정 없으면 자동 생성) — 구글 UX 표준.
- **보안 세션 설정**(`assets/auth.js`의 클라이언트 생성):
  - `flowType: 'pkce'` — OAuth 인가코드 가로채기 방지(SPA 보안 표준).
  - `autoRefreshToken` — 액세스 토큰(1h) 만료 전 자동 갱신 → 끊김 없는 세션.
  - `persistSession` — 리프레시 토큰 보관, 재방문 로그인 유지.
  - `detectSessionInUrl` — OAuth/매직링크 복귀 시 URL 토큰 회수 후 주소창 정리.
- **세션 관리 UI**: 계정 페이지에 로그아웃 + **모든 기기에서 로그아웃**(`signOut({scope:'global'})` → 전역 세션 무효화). 세션 자동갱신·만료 안내 문구.
- **비밀번호 보안**: Supabase가 서버에서 **단방향 해시(bcrypt)로 저장** — 운영자도 원문 불가. 전 통신 HTTPS. 클라이언트는 원문 비번을 저장하지 않음.
- **개인정보보호법(PIPA) 준수 고지**(privacy 페이지 ko/en 갱신): 수집항목(이메일·해시비번·구글 이메일)·목적·보유기간·동의거부권·처리위탁(Supabase)·국외이전·정보주체 권리(열람·정정·삭제·처리정지) 명시. 가입 시 약관/개인정보 동의 체크(이메일 가입) + 구글 가입 시 동의 고지문.

## ⚠️ 대표가 해야 하는 것 — 구글 OAuth 활성화 (코드로 불가, 구글 계정 필요)

구글 로그인 버튼은 배선됐지만, **구글 인증을 켜려면 구글 계정으로 자격증명을 발급**해야 한다(내가 대신 만들 수 없음). 5분:

1. **Google Cloud Console** (console.cloud.google.com) → 프로젝트 생성 → "API 및 서비스" → **OAuth 동의 화면** 구성(외부, 앱 이름 ThisIsMyPDF, 지원 이메일).
2. "사용자 인증 정보" → **OAuth 2.0 클라이언트 ID** 생성(유형: 웹 애플리케이션).
   - **승인된 리디렉션 URI**에 다음 추가:
     `https://gysvtgnpacqjpdijbcaw.supabase.co/auth/v1/callback`
   - (커스텀 도메인 배포 후에도 이 Supabase 콜백 URL은 그대로 — 구글은 Supabase로 돌아온 뒤 우리 사이트로 리다이렉트).
3. 발급된 **클라이언트 ID·시크릿**을 **Supabase 대시보드** → Authentication → Providers → **Google** 에 붙여넣고 Enable.
4. 같은 화면 **URL Configuration**에서 Site URL = 배포주소, Redirect URLs에 `배포주소/account/`·`배포주소/ko/account/` 추가(이메일 확인·구글 복귀가 올바른 곳으로).

이 4단계 전까지 구글 버튼은 "provider not enabled" 에러를 친절히 안내(사이트는 정상, 이메일 가입·로그인은 이미 작동).

## 권장 추가 보안 설정 (Supabase 대시보드 토글, 선택)

- Authentication → **Leaked password protection** 활성화(HaveIBeenPwned 대조 — 유출 비번 차단).
- **최소 비밀번호 길이/복잡도** 상향(현재 8자, 필요시 강화).
- 이메일 **rate limit**·확인메일 필수 유지(가입 남용 방지). 가입자 증가 시 커스텀 SMTP 연결(기본 SMTP는 시간당 발송 제한 작음).

## 검증(라이브 배포 후 할 것)
- 이메일 가입 → 확인메일 → 로그인 → 계정 → 로그아웃(단일/전역) 1회 실측.
- 구글 버튼: 위 4단계 후 실제 구글 로그인 왕복 1회.
- (이 컨테이너는 외부망 차단이라 실왕복은 배포 환경에서만 가능 — 코드 경로·PKCE·버튼·세션설정은 로컬 Playwright로 검증 완료.)
