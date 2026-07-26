/* 브라우저용 Convex 클라이언트 번들 엔트리.
   사이트는 무빌드(정적)라, 이 파일만 esbuild로 미리 묶어 assets/vendor/convex.js 로 커밋한다
   (pdf-lib·supabase.js와 같은 방식). 재생성: node scripts/build-vendor-convex.mjs

   ConvexHttpClient를 쓰는 이유: 로그인·계정·백오피스는 요청-응답이면 충분하고,
   웹소켓 기반 ConvexClient는 실시간 구독 + 인증 갱신 수명주기까지 딸려와 번들과 복잡도가 커진다. */
import { ConvexHttpClient } from "convex/browser";
export { ConvexHttpClient };
