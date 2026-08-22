# ThisIsMyPDF 최종 검수·출시 런북 (2026-08-22)

대표 지시: "기능 전체 테스트·기획검수 최종 1회 → 도메인 웹 출시 → iOS·Android 앱 출시".
이 문서 = 실측 결과 + 남은 T0(대표 클릭) 목록. 총괄(T1) 몫은 전부 준비·검증 완료 상태다.

## 1. 기능 전체 테스트 — 실측 (로컬, ci.yml 과 동일 순서)

| 게이트 | 결과 |
|---|---|
| 단위(backend-sql-unit) · 커버리지 래칫 · 제품계약 래칫 · i18n 래칫 · npm audit(high+) | PASS ×5 |
| 단일 빌드 → structural · smoke-pdf-merge · admin-smoke · pages-smoke · cv-tools-func · redact-func | PASS ×7 |
| 폐쇄망 번들 빌드 + 외부요청 0 계약(offline-bundle) | PASS ×2 |
| 우산 빌드 → umbrella-smoke · subsites-smoke · telemetry.spec · supabase-switch · auth-func · contact-func · pdf-func · image-func · calc-func · audio-tools-func · video-trim-func · video2-func · pwa-offline | PASS ×14 |
| a11y(axe, WCAG A/AA serious+ 0건) · 모바일 320px | PASS ×2 |
| **신규** native-bridge(앱 다운로드 브리지 + 웹빌드에 mobile/ 미혼입) | 아래 §3 |

**30/30 ALL PASS.** 라이브(gh-pages)는 main 4b3232a 컷오버본, 이후 main 변경은 docs·SQL 테스트뿐이라 라이브 기능 동일.

## 2. 기획검수 (product-contract / 헌장 대조)

- 헌장(app.charter.yaml): backend=supabase ✔ · i18n en/ko 전수 ✔(i18n-audit) · seo ✔(structural) · offline ✔ · a11y wcag-aa ✔ · privacy no-pii-telemetry ✔(telemetry.spec).
- 제품계약 10개 PDF 도구(pdf-compress/extract/merge/organize/page-numbers/rotate/sign/split/to-jpg/watermark + img-to-pdf): 상태·오류·불변식·테스트 연결 전부 contract-audit 통과. 실제 산출물(PDF 바이트) 파싱 검증 = pdf-func.
- 회원: 이메일 가입/로그인/전기기 로그아웃/계정삭제 ✔. **구글 로그인 = 코드 완성·플래그 OFF**(공급자 설정 T0). 비밀번호 재설정 = 없음(SMTP T0 와 묶임, P1).
- 수익: 가격 페이지 = 수요검증(waitlist) 모드 유지. AdSense = 도메인 후.
- 검수 결론: **출시 차단 결함 0건.** 출시 후 P1 = 비밀번호 재설정(SMTP 확보 시), P2 = 가입 약관 체크박스 → 고지문구.

## 3. 모바일 앱 (신규 — `mobile/`)

결정: **Capacitor 래퍼 + 폐쇄망 번들(OFFLINE=1 SITE=pdf)**. tripodfish 관례(expo-app 스택)와 다른 이유 —
이 제품은 정적 HTML 도구 모음이라 React Native 로 재작성하지 않고 웹 번들을 그대로 포장하는 것이
맞고, 오프라인 번들은 회원·수집·광고가 없어 스토어 개인정보 항목("수집 없음")과 계정삭제 요건이
비며 "파일이 기기를 떠나지 않는다"가 앱에서도 그대로 성립한다(심사 4.2 "웹사이트 래퍼" 리스크도
원격 URL 이 아닌 내장 번들·오프라인 동작·네이티브 공유시트로 방어).

- `scripts/build-mobile.mjs` → `mobile/www`(6MB) + 아이콘 PNG(1024/512/192) + Android mipmap 5밀도·적응형 전경 + iOS AppIcon 1024 + 스플래시(iOS 3장·Android drawable 11종).
- `assets/site.js` mdtlDownload: 앱이면 Filesystem(CACHE) → Share 시트, 웹은 기존 a[download]. 회귀 테스트 `tests/native-bridge.mjs`(ci.yml 등록).
- `scripts/build.mjs` SKIP 에 `mobile` 추가 — 출력 폴더 자기 재귀 복사 행(hang) + 네이티브 프로젝트 공개사이트 유출 차단.
- `.github/workflows/mobile.yml`: Android = AAB(release)+APK(debug) 산출, 시크릿 있으면 서명. iOS = 서명 없을 땐 컴파일 검증, 시크릿 있으면 IPA export(app-store-connect).
- appId `com.thisismy.pdf`, 이름 ThisIsMyPDF, versionCode/빌드번호는 workflow_dispatch 입력.

### 스토어 등록 정보(복붙용)
- 이름: ThisIsMyPDF / 부제: PDF tools that never upload your files
- 카테고리: Productivity / Utilities. 연령: 4+ / 전체이용가.
- 개인정보 URL: https://greykodiak-goods.github.io/modutool/pdf/privacy/ (도메인 후 https://thisismypdf.com/privacy/) · 지원 URL: …/contact/
- 개인정보(App Privacy / Data safety): **Data not collected** — 앱 번들은 네트워크 요청 0(offline-bundle 계약으로 CI 검증).
- 설명(en): Merge, split, compress, rotate, sign, watermark, number, organize and convert PDFs — entirely on your device. No upload, no account, works offline.
- 설명(ko): PDF 병합·분할·압축·회전·서명·워터마크·쪽번호·정리·변환을 전부 기기 안에서. 업로드 없음, 계정 없음, 오프라인 동작.
- 스크린샷: `node scripts/store-screens.mjs` → `mobile/store/`(iPhone 6.7" 1290×2796, Android 1080×1920).

## 4. 대표 T0 — 이것만 하면 전부 자동

### 웹(도메인) — 10~15분, `docs/2026-08-22-cloudflare-cutover.md` 그대로
1. Cloudflare Registrar 에서 **thisismypdf.com 구매**.
2. Workers & Pages → Pages → Connect to Git → `greykodiak-goods/modutool`: 프로젝트 `thisismypdf` / branch `main` / build `node scripts/build.mjs` / output `dist` / env `DEPLOY_ORIGIN=https://thisismypdf.com`.
3. Custom domains → thisismypdf.com 추가. → 총괄: live-check·canonical 대조·Search Console·live-check URL 교체(T1).

### 앱
4. **Google Play Console 개발자 등록($25 1회)** → 앱 생성(com.thisismy.pdf) → Play App Signing 사용.
   업로드키: 총괄이 CI 산출 AAB 를 받으면 안내하는 keytool 1회 실행 or Play 콘솔 "Google 생성 키" 선택 — 후자 권장(키 관리 0).
   등록 후 시크릿 4개(ANDROID_KEYSTORE_B64/…PASSWORD/…ALIAS/…KEY_PASSWORD)를 리포 Settings→Secrets 에 입력.
5. **Apple Developer Program($99/년)** → Certificates: Distribution 인증서(.p12) + App Store 프로비저닝(com.thisismy.pdf) → 시크릿 4개(IOS_P12_B64/IOS_P12_PASSWORD/IOS_PROVISION_B64/APPLE_TEAM_ID).
   App Store Connect 에 앱 생성(Bundle ID 동일).
6. 이후 총괄: `Mobile` 워크플로 dispatch(version_code) → AAB/IPA 산출 → Play 내부테스트 트랙·TestFlight 업로드(업로드 자체는 콘솔 로그인이 필요해 대표 1클릭 or API 키 전달 시 자동).

### 기존 대기(변경 없음)
7. Supabase Auth 이메일확인 OFF 또는 SMTP · 8. 구글 OAuth 공급자(→ auth-config google:true) · 9. AdSense(도메인 후 48h).

## 5. 미해결·주의
- iOS 실기기/TestFlight 검증은 Apple 계정 전이라 미실행 — CI 컴파일 검증(서명 없음)까지만 자동. 서명 시크릿 등록 직후 첫 IPA 로 TestFlight 스모크(도구 1개 실제 저장)까지 총괄이 한다.
- Android 도 실기기 미검증(로컬 SDK 없음) — CI debug APK 를 대표 폰에 설치해 pdf-merge 1회 저장 확인이 인수 기준.
