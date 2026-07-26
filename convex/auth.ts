/* Convex Auth — 로그인/회원가입 백엔드.
   자체 구현이 아니라 공식 라이브러리(@convex-dev/auth, 내부적으로 Auth.js/@auth/core + Lucia 계열
   세션 처리)를 그대로 쓴다. 비밀번호 해싱(scrypt)·세션 발급/회전·OAuth 인가코드 교환 같은
   보안 원시요소를 직접 만들지 않는다 — 레포 규칙 "바퀴 재발명 금지"의 가장 중요한 적용 지점.

   왜 Supabase에서 옮기나: 무료 플랜 활성 프로젝트 2개 한도 때문에 thisismy-tools 프로젝트가
   반복적으로 INACTIVE로 떨어져 로그인이 실제로 먹통이 됐다(2026-07-26 실사고, 2회차).
   텔레메트리는 이미 Convex로 넘어갔으므로 인증까지 옮기면 이 앱에서 Supabase 의존이 사라지고
   한도 문제도 같이 사라진다.

   개인정보 최소수집(PIPA): 저장하는 것은 이메일과 (구글 로그인 시) 이름·프로필사진 URL뿐이다.
   비밀번호는 평문으로 보관되지 않는다(라이브러리가 해시만 authAccounts에 저장).
   ⚠️ 계정 삭제(파기) 경로는 account.ts의 deleteAccount — 영구삭제라 클라이언트에서
      명시적 확인을 받은 뒤에만 호출된다. */
import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import Google from "@auth/core/providers/google";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    /* 이메일+비밀번호. 라이브러리 기본 검증은 "비어있지 않고 8자 이상"이라,
       거기에 영문·숫자 혼합과 상한만 더한다. */
    Password({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("invalid_email");
        return { email };
      },
      validatePasswordRequirements(password: string) {
        // 8자 이상 + 영문·숫자 혼합. NIST 800-63B 권고에 맞춰 "특수문자 강제"는 하지 않고
        // 길이를 우선한다(강제 복잡도는 오히려 추측 가능한 패턴을 유발).
        if (password.length < 8) throw new Error("password_too_short");
        if (password.length > 128) throw new Error("password_too_long");
        if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw new Error("password_too_simple");
      },
    }),

    /* 구글 OAuth — 인가코드 교환은 서버(Convex action)에서만 일어난다.
       clientId/secret은 Convex 환경변수 AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET에서 읽는다.
       미설정이면 이 공급자는 런타임에 실패하므로, 프론트는 버튼을 숨긴다(MDTL_CONVEX.google). */
    Google,
  ],
});
