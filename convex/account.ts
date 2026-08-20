/* 회원 계정 관련 조회·변경. 인증 주체는 항상 getAuthUserId(ctx)에서 나온다 —
   클라이언트가 보낸 userId/email을 신뢰하지 않는다(권한 상승 차단). */
import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId, invalidateSessions } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { adminStatus } from "./lib/adminAccess";

async function currentUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  return user ? { userId, user } : null;
}

/* 로그인한 본인의 상태. 미로그인이면 null(에러가 아니라 null — 헤더 렌더가 조용히 처리). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const cur = await currentUser(ctx);
    if (!cur) return null;
    const email = (cur.user as { email?: string }).email ?? "";
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", cur.userId))
      .unique();
    return {
      email,
      name: (cur.user as { name?: string }).name ?? null,
      plan: profile?.plan ?? "free",
      planExpiresAt: profile?.planExpiresAt ?? null,
      // 이메일 등재 + 검증된 인증수단 동시 요구 — 비밀번호 선점 가입 권한상승 차단(lib/adminGate.js)
      isAdmin: await adminStatus(ctx),
      createdAt: cur.user._creationTime,
    };
  },
});

/* 최초 로그인 직후 프로필 문서를 만든다(없을 때만). plan은 항상 free로 시작 —
   이 mutation으로는 premium을 만들 수 없다(인자 자체가 없다). */
export const ensureProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const cur = await currentUser(ctx);
    if (!cur) throw new Error("not_authenticated");
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", cur.userId))
      .unique();
    if (existing) return { created: false, plan: existing.plan };
    const email = ((cur.user as { email?: string }).email ?? "").toLowerCase();
    await ctx.db.insert("profiles", { userId: cur.userId, email, plan: "free" });
    return { created: true, plan: "free" as const };
  },
});

/* 계정 영구 삭제(파기) — 개인정보 삭제 요구권 대응.
   ⚠️ 되돌릴 수 없다. 클라이언트가 이메일을 그대로 타이핑해 확인한 경우에만 호출된다.
   프로필 → 인증 계정 → 세션/리프레시토큰 → 사용자 순으로 지운다(세션을 먼저 지우면
   진행 중 요청이 인증을 잃어 나머지 정리가 실패할 수 있다). */
export const deleteAccount = mutation({
  args: { confirmEmail: v.string() },
  handler: async (ctx, { confirmEmail }) => {
    const cur = await currentUser(ctx);
    if (!cur) throw new Error("not_authenticated");
    const email = ((cur.user as { email?: string }).email ?? "").toLowerCase();
    if (confirmEmail.trim().toLowerCase() !== email) throw new Error("email_mismatch");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", cur.userId))
      .unique();
    if (profile) await ctx.db.delete(profile._id);

    // 세션 → 그 세션의 리프레시토큰까지 (인덱스 이름은 authTables 정의를 따른다)
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", cur.userId as Id<"users">))
      .collect();
    for (const s of sessions) {
      const tokens = await ctx.db
        .query("authRefreshTokens")
        .withIndex("sessionId", (q) => q.eq("sessionId", s._id))
        .collect();
      for (const t of tokens) await ctx.db.delete(t._id);
      await ctx.db.delete(s._id);
    }

    // 인증수단(비밀번호 해시·구글 연결). authAccounts에는 userId 단독 인덱스가 없고
    // userIdAndProvider 복합 인덱스의 접두로 조회한다.
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", cur.userId as Id<"users">))
      .collect();
    for (const a of accounts) await ctx.db.delete(a._id);

    await ctx.db.delete(cur.userId);
    return { ok: true };
  },
});

/* 모든 기기에서 로그아웃 — 이 사용자의 세션을 전부 무효화한다.
   라이브러리의 invalidateSessions를 쓴다(세션·리프레시토큰 정리 규칙을 직접 구현하지 않음).
   action인 이유: invalidateSessions가 action 컨텍스트를 요구한다. */
export const signOutEverywhere = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("not_authenticated");
    await invalidateSessions(ctx, { userId });
    return { ok: true };
  },
});
