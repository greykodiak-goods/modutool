// 운영 시드/관리 — CLI 전용(internal): npx convex run admin:seedAdmin '{"email":"..."}'
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const seedAdmin = internalMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const norm = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(norm)) throw new Error("invalid email");
    const existing = await ctx.db
      .query("adminUsers")
      .withIndex("by_email", (q) => q.eq("email", norm))
      .unique();
    if (existing) return { ok: true, already: true };
    await ctx.db.insert("adminUsers", { email: norm });
    return { ok: true, already: false };
  },
});
