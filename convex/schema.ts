// Convex 스키마 — Supabase(gysvtgnpacqjpdijbcaw) 대응 이관본
// 매핑: tool_events → toolEvents / admin_users → adminUsers / profiles → profiles
// _creationTime(내장)이 created_at을 대체한다.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  /* Convex Auth가 관리하는 표(users / authAccounts / authSessions / authRefreshTokens /
     authVerificationCodes / authVerifiers / authRateLimits). 직접 정의하지 않고 라이브러리
     스키마를 그대로 펼친다 — 비밀번호 해시·세션·리프레시토큰 구조를 우리가 설계하지 않는다. */
  ...authTables,

  // 익명 결과 텔레메트리 — 클라이언트는 HTTP action으로 INSERT만 가능(조회 불가),
  // 개인정보·파일명·입력값은 절대 저장하지 않는다(화이트리스트는 mutation에서 강제).
  toolEvents: defineTable({
    tool: v.string(),
    outcome: v.union(
      v.literal("success"),
      v.literal("no_result"),
      v.literal("error"),
      v.literal("unsupported"),
      v.literal("cancelled"),
      v.literal("view"),
    ),
    reason: v.optional(v.string()),
    lang: v.optional(v.string()),
    site: v.optional(v.string()),
    ua: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    meta: v.optional(v.any()), // logEvent mutation이 화이트리스트·크기 재검증
  })
    .index("by_tool", ["tool"])
    .index("by_outcome", ["outcome"]),

  /* 일별 집계 롤업 — NoSQL의 GROUP BY 약점 대응.
     문서DB에는 집계 엔진이 없어 대시보드가 원본을 전부 스캔해야 하는데,
     Convex는 쿼리 1회당 읽기 상한(문서 수·바이트)이 있어 로그가 쌓이면 스캔이 깨진다.
     그래서 "쓸 때 미리 세어두는" 방식으로 뒤집는다: logEvent가 (일자×도구×결과) 카운터를 증분.
     대시보드는 원본 대신 이 표를 읽으므로 로그가 몇백만 건이 돼도 읽는 문서 수가 일정하다.
     ⚠️ 트래픽이 매우 커지면 한 문서에 쓰기가 몰려 낙관적 동시성 재시도가 늘 수 있다 →
        그때는 key에 샤드 접미사를 붙여 분산할 것(예: `${ymd}|${tool}|${outcome}|s3`). */
  dailyStats: defineTable({
    key: v.string(),        // `${ymd}|${tool}|${outcome}` — 조회·증분용 단일 키
    ymd: v.string(),        // YYYY-MM-DD (UTC)
    tool: v.string(),
    outcome: v.string(),
    count: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_ymd", ["ymd"]),

  /* 문의 메시지 — 사이트에 연락 수단이 필요해서 만든다(AdSense 정책 요건이기도 하고,
     About 페이지가 "문의 이메일로 보내달라"고 하면서 정작 이메일이 없던 상태였다).
     개인 이메일을 공개 페이지에 노출하면 스팸에 수확당하므로 폼 + 서버 저장 방식으로 간다.
     ⚠️ 개인정보 최소수집: 답장이 필요한 사람만 이메일을 남긴다(선택). 내용·이메일 길이는 서버가 자른다. */
  contactMessages: defineTable({
    email: v.optional(v.string()),   // 답장 원할 때만
    subject: v.string(),
    body: v.string(),
    lang: v.optional(v.string()),
    site: v.optional(v.string()),    // 어느 브랜드에서 왔는지(pdf/img/calc/video)
    handled: v.boolean(),            // 백오피스에서 처리 표시
  }).index("by_handled", ["handled"]),

  /* 스팸·폭주 방어용 분 단위 카운터. 공개 엔드포인트라 상한이 없으면 DB가 쓰레기로 찬다.
     IP는 저장하지 않는다(개인정보) — 전체 분당 상한만 건다. */
  contactRate: defineTable({
    minute: v.string(),              // YYYY-MM-DDTHH:MM (UTC)
    count: v.number(),
  }).index("by_minute", ["minute"]),

  // 백오피스 접근 화이트리스트 (dashboard 쿼리가 참조)
  adminUsers: defineTable({
    email: v.string(),
  }).index("by_email", ["email"]),

  /* 회원 플랜 (auth users와 1:1) — 쓰기는 서버 함수만. 클라이언트가 스스로 premium으로
     올리지 못하도록 public mutation을 두지 않는다(결제 연동 시 서버 검증 후 internal로 승급).
     userId는 authTables의 users 문서를 가리킨다. */
  profiles: defineTable({
    userId: v.id("users"),
    email: v.string(),
    plan: v.union(v.literal("free"), v.literal("premium")),
    planExpiresAt: v.optional(v.number()), // ms epoch
  })
    .index("by_user", ["userId"])
    .index("by_email", ["email"]),
});
