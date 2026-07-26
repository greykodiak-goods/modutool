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
