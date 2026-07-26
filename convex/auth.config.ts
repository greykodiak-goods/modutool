/* Convex Auth가 발급한 JWT를 이 배포가 신뢰하도록 등록.
   CONVEX_SITE_URL은 배포가 자동으로 주입한다(https://<deployment>.convex.site). */
export default {
  providers: [{ domain: process.env.CONVEX_SITE_URL, applicationID: "convex" }],
};
