/* ConvexHttpClient 브라우저 번들 엔트리 — window.ConvexHttpClient 전역 노출
   재번들: npx esbuild scripts/convex-entry.js --bundle --minify --format=iife --outfile=assets/vendor/convex-http.min.js */
import { ConvexHttpClient } from "convex/browser";
window.ConvexHttpClient = ConvexHttpClient;
