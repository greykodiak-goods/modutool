// 정적(무빌드) 사이트용 수집 엔드포인트 — 브라우저의 plain fetch POST를 받는다.
// site.js는 Supabase REST URL 대신 `https://<deployment>.convex.site/log-event`로 전환하면 끝.
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

// 배포 오리진 화이트리스트 (커스텀 도메인 확정 시 여기에 추가)
const ALLOWED_ORIGINS = new Set([
  "https://greykodiak-goods.github.io",
  "https://thisismypdf.com",
  "https://www.thisismypdf.com",
  "https://thisismyimg.com",
  "https://thisismycalculator.com",
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://greykodiak-goods.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const http = httpRouter();

/* Convex Auth의 OAuth 라우트(/api/auth/signin/*, /api/auth/callback/*).
   구글 인가코드 교환이 여기서 서버측으로 일어난다 — 클라이언트 시크릿은 브라우저에 나가지 않는다. */
auth.addHttpRoutes(http);

/* 문의 접수 — 공개 엔드포인트. 방어(길이·형식·분당 상한)는 전부 서버(contact:submit)에 있다.
   허니팟(hp) 필드가 채워져 있으면 봇으로 보고 조용히 201을 돌려준다(봇에게 실패를 알리지 않는다). */
http.route({
  path: "/contact",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, req) => new Response(null, { status: 204, headers: corsHeaders(req.headers.get("Origin")) })),
});
http.route({
  path: "/contact",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const headers = corsHeaders(req.headers.get("Origin"));
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return new Response("bad json", { status: 400, headers }); }

    if (typeof body.hp === "string" && body.hp.trim() !== "") {
      return new Response(null, { status: 201, headers });   // 허니팟 — 봇
    }
    const minute = new Date().toISOString().slice(0, 16);
    try {
      await ctx.runMutation(internal.contact.submit, {
        email: body.email == null ? undefined : String(body.email),
        subject: String(body.subject ?? ""),
        body: String(body.body ?? ""),
        lang: body.lang == null ? undefined : String(body.lang),
        site: body.site == null ? undefined : String(body.site),
        minute,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // 상한 초과는 400이 아니라 429로 알려야 사용자가 "잠시 후 다시"를 안다.
      if (msg.includes("rate_limited")) return new Response("too many", { status: 429, headers });
      return new Response("rejected", { status: 400, headers });
    }
    return new Response(null, { status: 201, headers });
  }),
});

http.route({
  path: "/log-event",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, req) => new Response(null, { status: 204, headers: corsHeaders(req.headers.get("Origin")) })),
});

http.route({
  path: "/log-event",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const headers = corsHeaders(req.headers.get("Origin"));
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return new Response("bad json", { status: 400, headers });
    }
    try {
      await ctx.runMutation(internal.telemetry.logEvent, {
        tool: String(body.tool ?? ""),
        outcome: String(body.outcome ?? "error"),
        reason: body.reason == null ? null : String(body.reason),
        lang: body.lang == null ? null : String(body.lang),
        site: body.site == null ? null : String(body.site),
        ua: body.ua == null ? null : String(body.ua),
        sessionId: body.session_id == null ? null : String(body.session_id),
        meta: body.meta ?? {},
      });
    } catch {
      return new Response("rejected", { status: 400, headers });
    }
    return new Response(null, { status: 201, headers });
  }),
});

export default http;
