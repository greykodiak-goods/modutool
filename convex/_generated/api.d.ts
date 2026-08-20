/* 임시 boilerplate — 배포 시 실제 codegen(`convex deploy`)이 덮어쓴다.
   컨테이너에서 convex.dev로 못 나가 `convex codegen`을 돌릴 수 없으므로 손으로 맞춰둔다.
   ⚠️ convex/ 에 모듈을 추가하면 여기에도 추가할 것 — 빠지면 internal.<모듈>이 타입에 없어
      로컬 tsc가 실패한다(2026-07-26 실사례: contact.ts 추가 시 여기가 stale이라 막혔다). */
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type * as account from "../account.js";
import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as contact from "../contact.js";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as retention from "../retention.js";
import type * as telemetry from "../telemetry.js";
declare const fullApi: ApiFromModules<{
  account: typeof account;
  admin: typeof admin;
  auth: typeof auth;
  contact: typeof contact;
  dashboard: typeof dashboard;
  http: typeof http;
  retention: typeof retention;
  telemetry: typeof telemetry;
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
