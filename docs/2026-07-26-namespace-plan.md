# 네임스페이스 정리안 (2026-07-26)

Doppler 도입 + Convex(NoSQL) 전환 + 한 오리진에 브랜드 4개가 얹히면서, "같은 이름이 서로 다른 것을
가리키는" 지점이 여러 층에서 동시에 생겼다. 층별로 **무엇이 네임스페이스 역할을 하는지** 먼저 정하고,
그 다음에 이름을 맞춘다. 접두사를 덕지덕지 붙이는 건 마지막 수단이다.

---

## 0. 요약 — 뭐뭐 하면 되나

| # | 층 | 지금 문제 | 조치 | 누가 |
|---|-----|-----------|------|------|
| 1 | Doppler | 한 프로젝트에 두 앱 키가 섞이면 `SUPABASE_URL`이 어느 앱 것인지 모름 | **앱당 Doppler 프로젝트 1개**로 분리 (`awning-ops`, `thisismy`) | 대표 |
| 2 | GitHub Secret | — (레포가 이미 네임스페이스) | 레포마다 `DOPPLER_TOKEN` 1개만. 이름은 양쪽 다 같아도 됨 | 대표 |
| 3 | 광고 유닛 | `ADFIT_UNIT_TOP` 1칸인데 브랜드는 4개 | 브랜드 접미사(`_PDF/_IMG/_CALC/_VIDEO`) | 대표(발급 후) |
| 4 | Convex | `dev:` 배포 키가 운영에 박혀 있음 | `prod:` 키로 교체, dev는 별도 키 | 대표 |
| 5 | 서비스워커 캐시 | 4브랜드가 한 오리진 → 서로 캐시를 지움 | **수정 완료** (캐시명에 스코프 포함) | ✅ 완료 |
| 6 | localStorage | 4브랜드가 한 오리진 → 키 공유 | 공유할 것/분리할 것 구분 (아래 5절) | 다음 작업 |
| 7 | Supabase 프로젝트 | 무료 2개 한도로 `thisismy-tools`가 INACTIVE = **로그인 먹통** | **이관 완료** — Convex Auth로 옮기고 Supabase 제거 (7절) | ✅ 완료 |

---

## 1. Doppler — 네임스페이스는 "프로젝트/컨피그"다

Doppler는 이미 `프로젝트 → 컨피그(환경) → 키` 3단이다. 이게 네임스페이스다.
**키 이름에 앱 접두사를 붙이는 건 이 구조를 버리고 평면으로 되돌리는 것**이라 권하지 않는다.

```
Doppler
├── awning-ops        (프로젝트)
│   ├── prd           → SUPABASE_URL = wcztgneaqmwfeuonyjny…
│   └── stg
└── thisismy          (프로젝트)
    ├── prd           → SUPABASE_URL = gysvtgnpacqjpdijbcaw…   ← 같은 이름, 충돌 없음
    └── dev
```

### 지금 실제로 겹치는 키

두 프로젝트가 요구하는 키를 실측(ops `doppler-check.yml`의 REQUIRED, modutool 워크플로 참조 키)한 결과:

| 키 | awning-ops | thisismy | 겹침 |
|----|:---:|:---:|----|
| `SUPABASE_URL` | ✅ wcztgn… | ~~gysvtg…~~ | ~~충돌~~ → **해소**(7절: thisismy에서 Supabase 제거) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ~~예정~~ | ~~충돌~~ → **해소** |
| `ANTHROPIC_API_KEY` / `CONTENT_LLM_KEY` | ✅ | (공유해도 무방) | 회색 |
| `COUPANG_PROXY_URL` / `COUPANG_PROXY_SECRET` | ✅ | — | 없음 |
| `CRON_SECRET` | ✅ | — | 없음 |
| `EC2_SSH_KEY` | ✅ | — | 없음 |
| `KAKAO_SMTP_USER/PASS/FROM` | ✅ | — | 없음 |
| `NAVER_CLIENT_ID/SECRET` | ✅ | — | 없음 |
| `META_APP_ID/SECRET`, `THREADS_APP_SECRET` | ✅ | — | 없음 |
| `CONVEX_DEPLOY_KEY` | — | ✅ | 없음 |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET` | — | ✅ | 없음 |
| `ADSENSE_CLIENT_ID`, `ADFIT_UNIT_TOP/BOTTOM` | — | ✅ | 없음(단 4절 참조) |

**결론: 진짜 충돌은 `SUPABASE_*` 2개뿐이었고, 7절의 Convex Auth 이관으로 그 2개가 사라졌다.**
즉 지금은 한 Doppler 프로젝트에 몰아둬도 실제로 부딪히는 키가 없다.

그래도 앱당 프로젝트 분리를 권하는 이유는 **다음 충돌을 미리 막기 위해서**다. 두 앱 모두
`ANTHROPIC_API_KEY`·`CRON_SECRET` 같은 일반명 키를 쓰게 될 가능성이 높고, 그때 접두사를 붙이면
코드가 `process.env.SUPABASE_URL` 류의 표준 이름을 못 읽어 앱마다 매핑 코드를 따로 둬야 한다.
프로젝트를 나누면 이름은 그대로 두고 격리만 얻는다. 급한 일은 아니다(당장 깨지는 건 없다).

### 대표가 할 일 (Doppler 웹)
1. 프로젝트 `thisismy` 생성, 컨피그 `prd` / `dev`.
2. `prd`에 넣을 키: `CONVEX_DEPLOY_KEY`(prod), `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `ADSENSE_CLIENT_ID`, 브랜드별 AdFit 유닛(4절).
3. `thisismy/prd` 읽기전용 서비스 토큰 발급 → **modutool 레포**의 GitHub Secret `DOPPLER_TOKEN`에 등록.
4. ops 레포의 `DOPPLER_TOKEN`은 그대로 둔다(`awning-ops/prd` 토큰).

### 왜 토큰 이름은 양쪽 다 `DOPPLER_TOKEN`이어도 되나
GitHub Secret은 **레포 단위로 이미 격리**돼 있다. `greykodiak-goods/awning-ops`의 `DOPPLER_TOKEN`과
`greykodiak-goods/modutool`의 `DOPPLER_TOKEN`은 서로 못 본다. 여기에 또 접두를 붙이면
워크플로 YAML만 지저분해지고 얻는 게 없다. (Organization secret으로 올릴 때만 이름이 겹치므로,
**org 레벨에는 올리지 말 것** — 올린다면 그때는 `DOPPLER_TOKEN_AWNING` / `DOPPLER_TOKEN_THISISMY`로 갈라야 한다.)

---

## 2. 코드가 키를 읽는 방식 — Doppler 우선, GitHub 폴백

이미 `convex-deploy.yml`에 적용된 패턴을 표준으로 삼는다. Doppler에 값이 없으면 GitHub Secret →
Variable 순으로 떨어지고, 어느 쪽이든 `::add-mask::`로 로그에서 가린 뒤 `GITHUB_ENV`로 넘긴다.
이 순서 덕에 **Doppler 이관을 한 번에 안 해도 되고**, 이관 중에도 배포가 안 깨진다.

---

## 3. Convex — 네임스페이스는 "배포(deployment)"다

- `dev:` 배포와 `prod:` 배포는 **DB가 별개**다. 지금 `auth-config.js`에 박혀 있는
  `superb-echidna-510.convex.site`는 **dev 배포**라, 로컬에서 `convex dev`를 돌리면 함수가 덮어써진다.
- 조치: `prod:` 배포 키를 `thisismy/prd`의 `CONVEX_DEPLOY_KEY`에 넣고,
  dev 키는 `thisismy/dev`에 같은 이름으로 둔다(컨피그가 네임스페이스니 이름은 동일해도 됨).
- 배포 후 `auth-config.js`의 URL을 prod 배포 URL로 교체한다.

---

## 4. 브랜드별 값 — 여기는 접미사가 정답

한 앱 안에서 **같은 논리 키가 N개 인스턴스**를 갖는 경우다. 프로젝트 분리로는 못 푼다.
지금 해당하는 건 광고 유닛뿐이고, 브랜드가 4개(pdf/img/calc/video)다.

```
ADSENSE_CLIENT_ID              # 계정 단위 — 4브랜드 공통, 그대로 둔다
ADFIT_UNIT_TOP_PDF
ADFIT_UNIT_BOTTOM_PDF
ADFIT_UNIT_TOP_IMG
ADFIT_UNIT_BOTTOM_IMG
ADFIT_UNIT_TOP_CALC
ADFIT_UNIT_BOTTOM_CALC
ADFIT_UNIT_TOP_VIDEO
ADFIT_UNIT_BOTTOM_VIDEO
```

접미사(`_PDF`)를 쓰는 이유: `SITE` 빌드 변수가 이미 `pdf|img|calc|video`라
`ADFIT_UNIT_TOP_${SITE^^}` 한 줄로 뽑힌다. 접두사면 매칭 코드가 길어진다.

> 아직 AdFit/AdSense 승인 전이라 값이 없다. 승인되면 위 이름으로 넣기만 하면 된다.
> `doppler-check.yml`의 OPTIONAL 목록도 이 이름으로 갱신해 둔다.

---

## 5. 브라우저 안의 네임스페이스 — 오리진이 경계다

**이게 코드에서 제일 자주 물리는 지점이다.** 지금 4브랜드가 `github.io/modutool/{pdf,img,calc,video}/`로
**한 오리진**에 있다. 브라우저의 저장소는 전부 오리진 단위라 경로가 달라도 공유된다.

### 5-1. 서비스워커 캐시 — **버그였고, 고쳤다**
`CacheStorage`는 스코프가 아니라 오리진 공유다. 캐시 이름을 `mdtl-<빌드ID>`로만 뒀더니
`/img/`의 서비스워커가 activate될 때 "내 빌드ID가 아닌 mdtl-* 캐시"인 `/pdf/` 캐시를 **지워버렸다**.
브랜드를 오갈 때마다 오프라인 캐시가 날아가는 셈.

```js
var SCOPE  = BASE.replace(/[^a-z0-9]+/gi, '-')…   // 'modutool-pdf'
var PREFIX = 'mdtl-' + SCOPE + '-';                // 'mdtl-modutool-pdf-'
var CACHE  = PREFIX + BUILD;
// activate: PREFIX로 시작하는 것만 삭제 → 다른 브랜드 캐시는 건드리지 않음
```
회귀 테스트 `tests/pwa-offline.mjs`에 고정(`/img/` 활성화 후 `/pdf/` 캐시 생존 + 오프라인 동작 유지).

### 5-2. localStorage — 다음에 정리할 것
현재 키는 전부 `mdtl-` 접두라 **다른 사이트와는** 안 부딪힌다. 문제는 **브랜드 사이**다.

| 키 | 지금 | 어떻게 해야 하나 |
|----|------|------------------|
| `mdtl-theme` | 4브랜드 공유 | 공유가 맞다 — 그대로 |
| `mdtl-lang` | 4브랜드 공유 | 공유가 맞다 — 그대로 |
| `mdtl-no-telemetry` | 4브랜드 공유 | 공유가 맞다(수집 거부는 사람 단위) — 그대로 |
| `mdtl-tel-force`, `mdtl-sw-force` | 개발용 | 그대로 |
| 세션·프리미엄 상태 | 공유 | **지금은 공유가 맞다**(한 계정이 4브랜드 이용) |
| 툴별 설정(향후) | — | `mdtl-<site>-<tool>-…` 로 나눌 것 |

⚠️ **도메인 분리 시점의 함정**: `thisismypdf.com` / `thisismyimg.com`으로 쪼개는 순간 오리진이 갈라져
위 "공유"가 전부 깨진다(테마·언어·로그인이 사이트마다 따로 논다). 도메인을 나눌 거라면
**로그인 상태는 localStorage가 아니라 서버(Convex) 세션 + 브랜드별 콜백**으로 설계해 둬야 하고,
테마·언어는 사이트마다 다시 물어보는 걸 감수하는 게 낫다(쿠키 공유용 상위 도메인이 없으므로).
→ 이 제약 때문에 **경로형(한 오리진) 유지**가 당분간 유리하다.

### 5-3. 전역 JS 이름
`window.MDTL_*`(BASE/SITE_BRAND/SITE_MARK/AUTH/CONVEX)와 `window.mdtl*()` 함수로 이미 통일돼 있다.
신규 코드도 이 접두를 지킬 것. 벤더 라이브러리(`PDFLib`, `cv`, `FFmpeg`)는 전역을 잡으므로
같은 페이지에 두 엔진을 동시에 올리지 않는다(현재 툴 1개 = 엔진 1개라 문제 없음).

---

## 6. URL·SEO 네임스페이스

이미 정리돼 있으나 규칙으로 못 박아 둔다.
- 정본은 `/<brand>/<tool>/`(영문), 한국어는 `/<brand>/ko/<tool>/`.
- 구 루트 URL(`/pdf-merge/`)은 리다이렉트 스텁 62개로만 존재하고 `noindex`.
- sitemap은 루트가 index, 브랜드별 sitemap 4개를 참조.
- **새 툴을 만들 때 slug는 전 브랜드에서 유일해야 한다** — `build.mjs`의 `CAT_SLUGS`가
  slug → 카테고리 단일 매핑이라 중복 slug는 조용히 잘못된 사이트로 들어간다.
  (`img-to-pdf`가 pdf·image 양쪽에 의도적으로 들어간 유일한 예외.)

---

## 7. 로그인 먹통 → Convex Auth 이관으로 해결 (같은 날 처리 완료)

`thisismy-tools` Supabase 프로젝트가 무료 플랜 활성 2개 한도 때문에 **또 INACTIVE**로 떨어져
(현재 활성은 awning-ops와 realestate-auction) 로그인·회원가입이 실제로 먹통이었다.

일시 조치(다른 프로젝트 일시정지)는 지난번에도 했고 남의 작업을 멈추는 부작용이 있어 반복하지 않았다.
대신 **Convex Auth(@convex-dev/auth)로 이관해 이 앱에서 Supabase를 통째로 걷어냈다.**
Supabase 슬롯 하나가 비므로 한도 문제 자체가 사라진다.

이건 네임스페이스 관점에서도 정리다 — 앱마다 백엔드가 하나씩 대응하게 되어
1절의 `SUPABASE_URL` 충돌이 modutool 쪽에서는 아예 없어졌다(남은 건 ops 하나뿐).

| 옛 Supabase | 현재 Convex |
|---|---|
| `auth.users` (GoTrue) | `@convex-dev/auth` — users/authAccounts/authSessions/… |
| `profiles` (email 키) | `profiles` (userId → users 참조) |
| `mdtl_tool_dashboard` RPC | `dashboard:dashboard` 쿼리 |
| SDK 207KB | `assets/vendor/convex.js` 18KB |

이관 시 배운 것(같은 함정 재발 방지):
- `npx convex env get`은 **변수가 없어도 종료코드 0**이다. `if npx convex env get X; then`으로
  존재를 판단하면 항상 "있음"이 되어 서명키를 만들지 않고 건너뛴다(→ jwks.json 500 = 로그인 불가).
  출력 유무로 판단할 것.
- Convex는 운영에서 **서버 예외 메시지를 감춘다**. 비밀번호 정책 같은 안내는 클라이언트에도
  같은 규칙을 두어야 사용자가 이유를 안다(강제력은 서버, 안내는 클라이언트).
- 서명키를 갈아끼우면 **발급된 세션이 전부 무효**가 된다 — 있으면 절대 덮어쓰지 않는다.
