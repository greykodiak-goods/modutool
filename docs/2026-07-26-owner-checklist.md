# 대표가 해야 할 일 — 체크리스트 (2026-07-26 기준)

내가 못 하는 것만 모았다(계정 로그인·결제·외부 심사가 필요한 것). 각 항목에 **정확한 값**을 적어뒀으니
그대로 복사해 넣으면 된다. 순서대로 하는 게 좋고, ①이 제일 급하다.

---

## ① 도메인 구매 — 지금 가장 큰 병목 (다른 게 다 여기 걸려 있다)

**왜 급한가**: AdSense는 도메인이 있어야 심사를 넣고, 심사가 2~4주다. Search Console도
`github.io` 하위 경로는 소유권 확인 방식이 제한된다. 즉 **도메인이 늦어지면 수익화 전체가 그만큼 밀린다.**

### 몇 개를 사야 하나 → **1개만 사시라**

브랜드가 4개(PDF/IMG/Calculator/Video)라 도메인도 4개를 살까 싶지만, **지금은 1개가 맞다**:
- 도메인을 쪼개면 오리진이 갈라져 **로그인·테마·언어 설정이 사이트마다 따로 논다**
  (브라우저 저장소는 오리진 단위다. 상세: `2026-07-26-namespace-plan.md` 5-2절)
- 검색 신뢰도도 4곳에 나뉘어 쌓인다. 초기엔 한 곳에 몰아야 빨리 오른다.
- 지금 구조(`/pdf/ /img/ /calc/ /video/`)가 그대로 살아서 **추가 작업이 거의 없다.**

→ 트래픽이 붙고 브랜드별로 독립할 이유가 생기면 그때 쪼개면 된다.

### 사고 나서 나에게 알려줄 것
**도메인 이름 하나**만 알려주시면 나머지는 내가 한다:
- 빌드 origin 교체(`/modutool/` 서브패스 → 루트), canonical·hreflang·sitemap 전부 재생성
- Convex CORS 허용 오리진에 새 도메인 추가
- Convex `SITE_URL` 교체 (OAuth 리다이렉트 허용 기준)
- 라이브체크 기준 URL 교체

### DNS 설정 (도메인 구매처 관리화면에서)
GitHub Pages 연결용. `example.com`을 산 경우:

| 타입 | 이름 | 값 |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `greykodiak-goods.github.io.` |

그리고 GitHub → `modutool` 레포 → Settings → Pages → **Custom domain**에 도메인 입력 →
**Enforce HTTPS** 체크(인증서 발급에 몇 분~1시간).

> ⚠️ IP는 GitHub Pages 공식 문서 기준값이다. 넣기 전에 GitHub Pages 설정 화면이 안내하는 값과
> 한 번 대조해 주시라 — 바뀌었을 가능성이 아주 낮지만 0은 아니다.

---

## ② Doppler `modutool` 프로젝트에서 불필요한 키 18개 삭제

ops 프로젝트를 복제해 만드신 것으로 보인다. **이 앱이 안 쓰는 키가 18개** 들어 있다.

Doppler → 프로젝트 `modutool` → config `prd` → 아래 키 삭제:

```
ALIGO_API_KEY            ALIGO_TEST_MODE          ALIGO_USER_ID
ANTHROPIC_API_KEY        COUPANG_PROXY_SECRET     COUPANG_PROXY_URL
CRON_SECRET              KAKAO_SMTP_FROM          KAKAO_SMTP_PASS
KAKAO_SMTP_USER          NAVER_CLIENT_ID          NAVER_CLIENT_SECRET
RESEND_API_KEY           RG_ORDERS_SYNC_ENABLED   RG_STOCK_SYNC_ENABLED
SMS_SENDER               SUPABASE_SERVICE_ROLE_KEY  SUPABASE_URL
```

**남길 것: `CONVEX_DEPLOY_KEY` 하나뿐** (+ 아래 ③④에서 추가할 키들).

**왜 지워야 하나**: 토큰으로 읽을 수 있는 범위 = 그 토큰이 유출됐을 때 노출되는 범위다.
지금은 modutool 배포 토큰 하나로 ops의 `SUPABASE_SERVICE_ROLE_KEY`(DB 전권)까지 읽힌다.
프로젝트를 분리한 이유가 이걸 막는 것이므로, 안 지우면 분리 효과가 없다.

> ops 쪽 `dcops` 프로젝트는 **건드리지 마시라** — 거기선 이 키들이 실제로 쓰인다.

**확인**: 삭제 후 modutool 레포 → Actions → **Doppler Check** 실행 →
`이 앱이 쓰지 않는 키` 항목이 `(없음 — 깔끔)`으로 나오면 완료.

---

## ③ Convex prod 배포로 전환 (트래픽 붙기 전에)

지금은 **dev 배포**(`superb-echidna-510`)로 운영 중이다. dev 배포는 누군가 로컬에서
`convex dev`를 돌리면 함수가 덮어써질 수 있어, 실사용자가 생기기 전에 옮겨야 한다.

1. Convex 대시보드 → 프로젝트 `thisismy-tools` → **Production** 배포 선택
2. Settings → **Deploy Keys** → Production 키 생성 (`prod:`로 시작)
3. Doppler `modutool/prd`의 `CONVEX_DEPLOY_KEY` 값을 **이 prod 키로 교체**
4. 나에게 알려주시면: prod 배포 실행 + `auth-config.js`의 URL 교체 + E2E 재검증까지 내가 한다

> dev 배포와 prod 배포는 **DB가 완전히 별개**다. 지금 dev에 쌓인 텔레메트리는 넘어가지 않는데,
> 어차피 테스트 데이터뿐이라 버려도 문제없다. (실사용자 계정도 아직 0명이다.)

---

## ④ 구글 로그인 켜기 (선택 — 안 해도 이메일 로그인은 정상 동작)

1. Google Cloud Console → 사용자 인증 정보 → **OAuth 클라이언트 ID 만들기** → 유형 **웹 애플리케이션**
2. **승인된 리디렉션 URI**에 아래를 그대로 추가:
   ```
   https://superb-echidna-510.convex.site/api/auth/callback/google
   ```
   (③에서 prod로 옮기면 prod 배포 호스트로 바꿔야 한다 — 그때 알려주겠다)
3. 발급된 값을 Doppler `modutool/prd`에 **이 이름 그대로** 넣기:
   ```
   AUTH_GOOGLE_ID       = (클라이언트 ID)
   AUTH_GOOGLE_SECRET   = (클라이언트 보안 비밀번호)
   ```
   ⚠️ `GOOGLE_OAUTH_CLIENT_ID` 같은 다른 이름으로 넣으면 **아무도 안 읽는다.**
   인증 라이브러리(@auth/core)가 `AUTH_<공급자>_ID` / `_SECRET`만 읽도록 고정돼 있다.
4. 나에게 알려주시면 배포 반영 + 실제 구글 로그인 왕복 검증까지 한다.

---

## ⑤ 검색 등록 (①이 끝난 뒤)

1. **Google Search Console** → 속성 추가 → **도메인** 방식(DNS TXT 레코드 1개 추가) —
   서브도메인까지 한 번에 잡혀서 URL 접두어 방식보다 낫다.
2. Sitemaps 메뉴에 `sitemap.xml` 제출 (하위 4개 브랜드 sitemap + 포털이 자동으로 따라간다)
3. 같은 방식으로 **Bing Webmaster Tools**, **네이버 서치어드바이저**도 등록
   (네이버는 국내 유입에 필요하고, Bing은 등록만 해두면 유지비가 0이다)
4. 등록 후 나에게 알려주시면 색인 상태를 주기적으로 확인할 수 있게 붙이겠다

> **여기서 나오는 숫자가 다음 개발 순서를 정한다.** 지금은 도구가 40개인데 색인이 됐는지조차
> 아무도 모르는 상태다. 색인이 확인돼야 "변환 매트릭스 12페이지 추가" 같은 확장이 의미가 있다.
> 확인 전에 페이지를 더 찍는 건 팔 곳 없이 재고를 쌓는 것이다.

---

## ⑥ 광고 심사 신청 (①이 끝난 뒤, 심사 2~4주)

1. **Google AdSense** 가입 → 사이트 추가 → 심사 신청
   - 승인 후 발급되는 `ca-pub-XXXXXXXX`를 Doppler에 `ADSENSE_CLIENT_ID`로 넣기
2. **카카오 AdFit** (국내 트래픽용) → 매체 등록 → 광고단위 생성
   - 브랜드 4개 × 상/하 = **8개 단위**를 만들고 아래 이름으로 Doppler에 넣기:
   ```
   ADFIT_UNIT_TOP_PDF     ADFIT_UNIT_BOTTOM_PDF
   ADFIT_UNIT_TOP_IMG     ADFIT_UNIT_BOTTOM_IMG
   ADFIT_UNIT_TOP_CALC    ADFIT_UNIT_BOTTOM_CALC
   ADFIT_UNIT_TOP_VIDEO   ADFIT_UNIT_BOTTOM_VIDEO
   ```
3. 넣고 알려주시면 슬롯 활성화·배치·검증은 내가 한다

> 심사에서 떨어지는 흔한 사유: 콘텐츠 부족 / 트래픽 0 / 개인정보처리방침 없음.
> 개인정보처리방침·이용약관 페이지는 이미 있고(en/ko), 도구 40개도 실제로 동작한다.
> 트래픽은 ⑤가 돌기 시작해야 생기므로 **⑤를 먼저 하고 ⑥을 하는 게 승인률이 높다.**

---

## 순서 요약

```
① 도메인 구매 ─┬─→ ⑤ 검색 등록 → (색인 확인) → 변환 매트릭스·언어팩 [내가]
               └─→ ⑥ 광고 심사 (2~4주) → 슬롯 활성화 [내가]

② Doppler 정리   ← 독립적, 지금 바로 가능 (5분)
③ Convex prod    ← 독립적, 트래픽 붙기 전까지
④ 구글 로그인    ← 선택
```

**②는 5분이면 되고 보안 관련이라 지금 바로 하시길 권한다. ①은 오늘 결정할수록 좋다.**
③④는 급하지 않다.

---

## 내가 이미 끝낸 것 (참고 — 대표 조치 불필요)

- 로그인·회원가입 복구(Convex Auth 이관, Supabase 의존 제거) — 라이브 실계정 왕복 검증 완료
- 오프라인 PWA(4브랜드) — 네트워크 차단 상태에서 PDF 병합 성공 검증
- 회원 탈퇴(계정 삭제) 기능 — 개인정보 삭제 요구권 대응
- 내부 CI 파일이 공개 사이트로 배포되던 문제 차단
- 포털이 sitemap에서 빠져 있던 문제 수정
- 색인 회귀 점검 자동화(canonical·hreflang·sitemap 생존·noindex 오부착)
