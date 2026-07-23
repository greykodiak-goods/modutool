// 결과 텔레메트리 수집 — Supabase RLS(INSERT-only) 정책의 Convex 대응.
// 공개 API는 http.ts의 HTTP action 하나뿐이고, 그 action이 이 internal mutation을 호출한다.
// 클라이언트는 조회 함수가 아예 없으므로 로그를 읽을 수 없다(기존 보안 모델 유지).
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

const OUTCOMES = new Set(["success", "no_result", "error", "unsupported", "cancelled"]);
// site.js telCleanMeta와 동일한 화이트리스트 — 서버에서 한 번 더 강제(다층 방어)
const META_KEYS = new Set([
  "pages", "count", "n", "size_bucket", "result_bucket", "level",
  "saved_pct", "err_name", "width", "height", "format", "quality", "seed",
]);

export const logEvent = internalMutation({
  args: {
    tool: v.string(),
    outcome: v.string(),
    reason: v.optional(v.union(v.string(), v.null())),
    lang: v.optional(v.union(v.string(), v.null())),
    site: v.optional(v.union(v.string(), v.null())),
    ua: v.optional(v.union(v.string(), v.null())),
    sessionId: v.optional(v.union(v.string(), v.null())),
    meta: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Supabase CHECK 제약과 동일한 서버측 검증
    const tool = String(args.tool).slice(0, 40);
    if (!tool) throw new Error("tool required");
    const outcome = OUTCOMES.has(args.outcome) ? args.outcome : "error";
    const clean: Record<string, string | number | boolean> = {};
    if (args.meta && typeof args.meta === "object" && !Array.isArray(args.meta)) {
      for (const [k, val] of Object.entries(args.meta as Record<string, unknown>)) {
        if (!META_KEYS.has(k)) continue;
        if (typeof val === "string") clean[k] = val.slice(0, 40);
        else if (typeof val === "number" && Number.isFinite(val)) clean[k] = Math.round(val * 100) / 100;
        else if (typeof val === "boolean") clean[k] = val;
      }
    }
    if (JSON.stringify(clean).length > 2000) throw new Error("meta too large");
    await ctx.db.insert("toolEvents", {
      tool,
      outcome: outcome as "success" | "no_result" | "error" | "unsupported" | "cancelled",
      reason: args.reason ? String(args.reason).slice(0, 60) : undefined,
      lang: args.lang === "ko" || args.lang === "en" ? args.lang : undefined,
      site: args.site ? String(args.site).slice(0, 12) : undefined,
      ua: args.ua ? String(args.ua).slice(0, 40) : undefined,
      sessionId: args.sessionId ? String(args.sessionId).slice(0, 40) : undefined,
      meta: clean,
    });
  },
});
