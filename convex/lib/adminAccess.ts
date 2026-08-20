/* 관리자 게이트 서버 헬퍼 — account.me / contact.list·setHandled 가 공유한다.
   판정 규칙(순수 로직)은 adminGate.js 참조. 여기서는 DB 조회만 담당한다. */
import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { isVerifiedAdmin } from "./adminGate.js";

/** 현재 로그인 사용자가 관리자면 true. 미로그인·미등재·미검증 계정은 전부 false. */
export async function adminStatus(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return false;
  const user = await ctx.db.get(userId);
  const email = (user as { email?: string } | null)?.email?.toLowerCase();
  if (!email) return false;
  const adminRow = await ctx.db
    .query("adminUsers")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (!adminRow) return false;
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId as Id<"users">))
    .collect();
  return isVerifiedAdmin(adminRow, user, accounts);
}

/** 관리자가 아니면 던진다 — 실패 사유를 구분해 주지 않는다(존재 여부 노출 방지). */
export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<void> {
  if (!(await adminStatus(ctx))) throw new Error("not authorized");
}
