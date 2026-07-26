// Convex 스키마 — Supabase(gysvtgnpacqjpdijbcaw) 대응 이관본
// 매핑: tool_events → toolEvents / admin_users → adminUsers / profiles → profiles
// _creationTime(내장)이 created_at을 대체한다.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
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

  // 백오피스 접근 화이트리스트 (dashboard 쿼리가 참조)
  adminUsers: defineTable({
    email: v.string(),
  }).index("by_email", ["email"]),

  // 회원 플랜 (auth 사용자 1:1) — 쓰기는 서버 함수만, 클라이언트 자가승급 차단
  profiles: defineTable({
    email: v.string(),
    plan: v.union(v.literal("free"), v.literal("premium")),
    planExpiresAt: v.optional(v.number()), // ms epoch
    authUserId: v.optional(v.string()),    // Convex Auth 연동 후 채움
  }).index("by_email", ["email"]),
});
