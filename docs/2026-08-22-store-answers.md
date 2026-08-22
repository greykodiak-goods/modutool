# 스토어 제출 — 대표가 할 것과 콘솔 설문 답안 (2026-08-22)

질문 "계정만 주면 바로 되나": **거의 그렇다.** 빌드·서명·업로드·스토어 설명·스크린샷·심사 제출은 전부
`Mobile release` 워크플로(`.github/workflows/mobile-release.yml`)가 한다. API 가 없는 **최초 1회 콘솔 설문**만
대표가 아래 답안대로 클릭한다(스토어당 10~15분). 키는 리포 Settings → Secrets 에 넣는다(값은 채팅 외 평문 금지).

## A. Google Play — 대표 순서

1. **개발자 계정 등록**($25, play.google.com/console). 개인 계정은 2023-11 이후 *20명 비공개 테스트 14일* 요건이
   붙는다 — 조직(사업자) 계정이면 면제. **데일리초이스 사업자로 등록 권장.**
2. **앱 만들기**: 이름 ThisIsMyPDF / 기본 언어 English (US) / 앱 / 무료.
3. **API 액세스 → 서비스 계정 생성**(Google Cloud 연결 자동) → 키(JSON) 다운로드 → 앱 권한 "출시 관리자" 부여
   → 시크릿 `PLAY_SERVICE_ACCOUNT_JSON` (JSON 전체 내용).
4. **앱 서명**: "Google 생성 키 사용"(Play App Signing) 선택. 업로드 키는 총괄이 CI 에서 생성해 시크릿 4개로 넣는다
   (`ANDROID_KEYSTORE_B64 / _PASSWORD / _KEY_ALIAS / _KEY_PASSWORD`) — 대표 작업 없음.
5. **대시보드 "앱 설정" 설문** — 답안:
   | 항목 | 답 |
   |---|---|
   | 개인정보처리방침 URL | https://thisismypdf.pages.dev/privacy/ (도메인 후 thisismypdf.com/privacy/) |
   | 앱 액세스 | 모든 기능이 제한 없이 사용 가능(로그인 없음) |
   | 광고 | 광고 없음 |
   | 콘텐츠 등급 | 설문: 유틸리티 · 폭력/성/약물/도박 전부 "아니오" · 사용자 생성 콘텐츠 없음 · 개인정보 공유 없음 → 전체이용가 |
   | 타겟층 | 18세 이상(아동 대상 아님 — 아동 대상 선택 시 정책 부담 증가) |
   | 뉴스 앱 | 아니오 |
   | 데이터 안전 | **수집하는 데이터 없음 · 공유 없음**(앱 번들은 네트워크 요청 0, CI offline-bundle 계약으로 검증) · 전송 암호화 N/A · 삭제 요청 N/A |
   | 정부 앱 / 금융 / 건강 | 전부 아니오 |
   | 카테고리 | 생산성 (Productivity) |
   | 연락처 이메일 | greykodiak1@gmail.com |
6. 완료 통보 → 총괄이 `Mobile release` dispatch(`play_track=internal`) → 내부 테스트 링크로 대표 폰 설치·pdf-merge 1회 저장 확인
   → `play_track=production` 재실행(심사 자동 제출, 보통 1~3일).

## B. Apple — 대표 순서

1. **Apple Developer Program** 가입($99/년, developer.apple.com). 개인 또는 조직(D-U-N-S 필요, 1~2주) — **개인으로 먼저** 가입해 시간 절약 가능.
2. **Certificates, Identifiers & Profiles**
   - Identifiers → App IDs → `com.thisismy.pdf` (Explicit, Capabilities 없음)
   - Certificates → Apple Distribution 생성(맥 없이: 총괄이 CSR 을 만들어 드림 → 업로드 → .cer 다운로드 → 총괄이 .p12 로 변환)
     → 시크릿 `IOS_P12_B64`, `IOS_P12_PASSWORD`
   - Profiles → App Store Connect 배포용 프로파일(위 App ID + 인증서) → 다운로드 → 시크릿 `IOS_PROVISION_B64`
   - Membership → Team ID → 시크릿 `APPLE_TEAM_ID`
3. **App Store Connect → Users and Access → Integrations → App Store Connect API → 키 생성(App Manager)**
   → 시크릿 `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`(.p8 파일 내용)
4. **My Apps → 새로운 앱**: iOS / 이름 ThisIsMyPDF / 기본 언어 English (U.S.) / Bundle ID com.thisismy.pdf / SKU thisismypdf.
5. **앱 정보 설문** — 답안:
   | 항목 | 답 |
   |---|---|
   | 연령 등급 | 모든 항목 "없음" → 4+ |
   | App Privacy | **데이터를 수집하지 않음(Data Not Collected)** |
   | 카테고리 | 생산성 / 유틸리티 (deliver 가 동기화) |
   | 콘텐츠 권리 | 타사 콘텐츠 없음 |
   | 수출 규정 | 암호화 면제(Info.plist `ITSAppUsesNonExemptEncryption=false` 로 자동 응답) |
   | 심사 연락처 전화번호 | **실번호 필요** — `mobile/fastlane/metadata/ios/review_information/phone_number.txt` 의 자리값(+82 10 0000 0000)을 대표 번호로 교체(총괄에게 알려주면 반영) |
6. 완료 통보 → 총괄이 `Mobile release` dispatch(`ios_submit_review=false`) → TestFlight 로 대표 폰 설치·저장 확인
   → `ios_submit_review=true` 재실행(심사 자동 제출, 보통 24~48h).

## C. 심사 리스크와 대비(이미 반영)

- Apple 4.2 "최소 기능/웹 래퍼": 원격 URL 이 아닌 **내장 번들·오프라인 동작·네이티브 공유시트 저장** — 심사 노트에 명시(`review_information/notes.txt`).
- Apple 5.1.1 계정 삭제 요건: 앱에 계정 없음 → 해당 없음.
- Play 데이터 안전 허위 신고 리스크: 앱 번들 네트워크 요청 0 을 CI 가 검증(offline-bundle).
- 양쪽 공통: 개인정보처리방침 URL 라이브(pages.dev) — 도메인 전환 시 `metadata/ios/*/privacy_url.txt` 와 Play 콘솔 URL 교체.

## D. 총괄 쪽 남은 것(대표 키 수령 후 자동)
- 업로드 키스토어 생성(CI keytool) → 시크릿 등록, Apple CSR/p12 변환, `Mobile release` 2회 실행(테스트→심사), 실기기 인수검사(대표 폰 설치 1회는 대표 협조).
