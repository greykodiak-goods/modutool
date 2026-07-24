/* 임시 boilerplate — 실제 codegen이 덮어쓴다 */
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as telemetry from "../telemetry.js";
declare const fullApi: ApiFromModules<{
  dashboard: typeof dashboard;
  http: typeof http;
  telemetry: typeof telemetry;
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
