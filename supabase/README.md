# (보관) Supabase 시절 마이그레이션

2026-07-21~26 동안 회원·텔레메트리 백엔드로 Supabase 프로젝트 `thisismy-tools`
(gysvtgnpacqjpdijbcaw)를 썼다. **2026-07-26 Convex로 전량 이관하면서 사용 중단**했다.

이관 사유: 무료 플랜은 조직당 활성 프로젝트 2개까지인데 이 계정엔 앱이 셋(awning-ops,
realestate-auction, thisismy-tools)이라, thisismy-tools가 반복적으로 INACTIVE로 떨어져
**로그인이 실제로 먹통**이 됐다(2회 발생). 다른 프로젝트를 멈추는 임시조치는 남의 작업을
멈추므로 반복하지 않고, 이 앱에서 Supabase 의존 자체를 걷어냈다.

현재 정본은 `convex/` 다:

| 옛 Supabase | 현재 Convex |
|---|---|
| `tool_events` | `toolEvents` + `dailyStats` 롤업 |
| `admin_users` | `adminUsers` |
| `profiles` | `profiles` (userId → authTables의 users) |
| `auth.users` (GoTrue) | `@convex-dev/auth` (`convex/auth.ts`) |
| `mdtl_tool_dashboard` RPC | `dashboard:dashboard` 쿼리 |

이 폴더는 스키마 이력 참고용으로만 남긴다 — 새 작업은 여기에 하지 말 것.
