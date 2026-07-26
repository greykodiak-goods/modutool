/* 문의 접수·조회.
   접수는 공개 HTTP action(누구나 보낼 수 있어야 하므로)이고, 조회는 관리자만 가능하다.
   공개 쓰기 엔드포인트라 방어를 서버에 둔다 — 클라이언트 검증은 안내용일 뿐 강제력이 없다. */
import { internalMutation, query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const MAX_SUBJECT = 120;
const MAX_BODY = 4000;
const MAX_EMAIL = 200;
const PER_MINUTE = 20;   // 전체 분당 상한 — 넘으면 조용히 거절하지 않고 429로 알린다

export const submit = internalMutation({
  args: {
    email: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    lang: v.optional(v.string()),
    site: v.optional(v.string()),
    minute: v.string(),
  },
  handler: async (ctx, a) => {
    const subject = a.subject.trim().slice(0, MAX_SUBJECT);
    const body = a.body.trim().slice(0, MAX_BODY);
    if (!subject || !body) throw new Error("empty");

    // 이메일은 선택. 넣었다면 형식만 확인하고, 이상하면 저장하지 않는다(잘못된 값을 굳이 보관하지 않음).
    let email: string | undefined;
    if (a.email && a.email.trim()) {
      const e = a.email.trim().slice(0, MAX_EMAIL).toLowerCase();
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) email = e;
    }

    const rate = await ctx.db
      .query("contactRate")
      .withIndex("by_minute", (q) => q.eq("minute", a.minute))
      .unique();
    if (rate && rate.count >= PER_MINUTE) throw new Error("rate_limited");
    if (rate) await ctx.db.patch(rate._id, { count: rate.count + 1 });
    else await ctx.db.insert("contactRate", { minute: a.minute, count: 1 });

    await ctx.db.insert("contactMessages", {
      email, subject, body,
      lang: a.lang?.slice(0, 5),
      site: a.site?.slice(0, 10),
      handled: false,
    });
    return { ok: true };
  },
});

/* 관리자 전용 조회. dashboard와 같은 게이트를 쓴다(이메일이 adminUsers에 있어야 함). */
async function requireAdmin(ctx: { auth: any; db: any }) {
  const userId = await getAuthUserId(ctx as never);
  if (!userId) throw new Error("not authorized");
  const user = await ctx.db.get(userId);
  const email = (user as { email?: string } | null)?.email?.toLowerCase();
  if (!email) throw new Error("not authorized");
  const admin = await ctx.db
    .query("adminUsers")
    .withIndex("by_email", (q: any) => q.eq("email", email))
    .unique();
  if (!admin) throw new Error("not authorized");
}

export const list = query({
  args: { onlyUnhandled: v.optional(v.boolean()) },
  handler: async (ctx, { onlyUnhandled }) => {
    await requireAdmin(ctx);
    const rows = onlyUnhandled
      ? await ctx.db.query("contactMessages").withIndex("by_handled", (q) => q.eq("handled", false)).order("desc").take(200)
      : await ctx.db.query("contactMessages").order("desc").take(200);
    return rows.map((r) => ({
      id: r._id, at: r._creationTime, email: r.email ?? null,
      subject: r.subject, body: r.body, lang: r.lang ?? null, site: r.site ?? null, handled: r.handled,
    }));
  },
});

export const setHandled = mutation({
  args: { id: v.id("contactMessages"), handled: v.boolean() },
  handler: async (ctx, { id, handled }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(id, { handled });
    return { ok: true };
  },
});
