# iLovePDF 로그인 기능 벤치마크 (2026-08-22)

대표 지시: "글로벌 서비스 타겟이라 구글 로그인 필수". 실페이지(/login, /register)와 공식 프로필 설정
가이드·보안 문서를 조사해 우리(ThisIsMyPDF, Supabase Auth) 현재 구현과 대조했다.

## iLovePDF 가 가진 것

| 영역 | 내용 |
|---|---|
| 로그인 방식 | 이메일+비밀번호 / **Google** / **Facebook** / 기업 SSO(SAML, 엔터프라이즈). Apple 없음 |
| 비밀번호 복구 | "Forgot your password?" 재설정 플로우 |
| 가입 마찰 | 약관은 체크박스 없이 "By creating an account, you agree…" 문구만(마찰 최소화) |
| 프로필 | 이름·국가·시간대·회사정보(VAT 포함)·이메일 변경, **소셜 로그인 연결(link) 관리** |
| 보안 | 비밀번호 변경, 2FA(FIDO2 키·SMS·백업코드), 계정 복구 시 2FA·대체 연락처 유도 |
| 프리미엄 연동 | Team(멤버 초대·역할·도구별 권한), Billing(플랜·크레딧·송장 다운로드) |
| 기타 | 작업 이력(2시간 보관·자동삭제) — 로그인 가치의 핵심 소구점 |

## 우리 현재 (2026-08-22 Supabase 재이관 직후)

있음: 이메일+비밀번호 가입/로그인(정책 8자+영숫자), 전기기 로그아웃, 계정 삭제(이메일 확인 게이트),
플랜 캐시·프리미엄 표시, **구글 PKCE 클라이언트 구현 완료(플래그 OFF — 공급자 설정 T0 대기)**.
없음: **비밀번호 재설정**, 프로필 편집, 이메일 변경, 소셜 연결 관리, 2FA, 결제(수요검증 모드).

## 격차 → 실행 우선순위 (매출/전환 접근성 기준)

1. **[P0·T0] 구글 로그인 켜기** — 대표 지시로 필수 확정. 프런트·테스트는 완성 상태라 공급자 설정만 남음.
   부가 효과: 구글 OAuth 계정은 이메일이 이미 검증돼 들어와 **"이메일 확인(confirm)" 문제를 우회**한다
   — 글로벌 유저 대부분이 구글 버튼을 누르면 SMTP 없이도 가입 마찰이 사라진다.
   - 대표 절차(10분): ① Google Cloud Console → OAuth 클라이언트(웹) — 7월 Convex 시절 만든 클라이언트가
     Doppler(AUTH_GOOGLE_ID/SECRET)에 있으면 **재사용**: 승인된 리디렉션 URI에
     `https://wcztgneaqmwfeuonyjny.supabase.co/auth/v1/callback` 추가만 하면 됨.
     ② Supabase 대시보드 → Authentication → Providers → Google: Client ID/Secret 입력, 활성화.
   - 이후 총괄(T1): auth-config `google: true` 플립 → 배포 → 실계정 왕복 검증(자동 스위트는 이미 커버).
2. **[P1] 비밀번호 재설정** — iLovePDF 대비 유일한 "기본기 구멍". Supabase `/auth/v1/recover` +
   재설정 페이지(en·ko)로 T1 구현 가능하나 **메일 발송이 필요해 SMTP(T0 ②)와 묶임**.
   구글 로그인이 켜지면 긴급도는 내려가지만, 이메일 가입자가 있는 한 반드시 필요.
3. **[P2] 가입 마찰 축소** — 약관 체크박스 → iLovePDF 식 고지 문구 전환 검토(전환율).
4. **[P3] 프로필 최소 편집(이름)·소셜 연결 관리** — Supabase identity linking 으로 가능. 유료 전환 후.
5. **[보류] 2FA·기업 SSO** — Supabase MFA(TOTP)로 나중에 켤 수 있음. 수요검증 단계에선 과함.
   Facebook 로그인도 후순위(글로벌 커버리지는 구글이 지배적, 유지비만 늘어남).

## 결론

구조적으로 우리가 못 따라갈 항목은 없다 — iLovePDF 계정 기능 전부가 Supabase 기본 기능(OAuth·recover·
MFA·identity linking) 범위 안이다. 병목은 전부 대시보드 콘솔 조작(T0)이며, 최우선 한 수는
**구글 공급자 설정**(대표 10분)이다. 그 한 번으로 "필수 지시 이행 + 이메일 확인 문제 우회 + 가입 마찰
제거" 세 가지가 동시에 풀린다.
