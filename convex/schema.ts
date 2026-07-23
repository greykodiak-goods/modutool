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
