/* 관리자 판정의 순수 로직 — DB·인증 컨텍스트 없이 테스트 가능하도록 분리(tests/admin-gate-unit.mjs).

   왜 이메일 등재만으로는 안 되나: 비밀번호 가입(auth.ts의 Password 공급자)은 이메일 소유
   확인이 없다. adminUsers에 등재된 이메일을 제3자가 먼저 비밀번호로 가입하면 그 계정이
   관리자로 판정되는 권한상승 경로가 생긴다(2026-08-21 감사에서 발견).

   그래서 관리자는 두 조건을 동시에 요구한다:
   ① 이메일이 adminUsers 화이트리스트에 있고
   ② 그 계정의 이메일 소유가 검증됐다 — OAuth 공급자(구글) 연결이 있거나,
      향후 이메일 인증 플로가 생기면 emailVerificationTime이 찍혀 있거나. */

/** 이메일 소유가 검증된 것으로 인정하는 OAuth 공급자 id 목록 (authAccounts.provider 값) */
export const VERIFIED_PROVIDERS = ["google"];

/**
 * 관리자 여부를 판정한다.
 * @param {object|null} adminRow adminUsers에서 이메일로 찾은 행 (없으면 null)
 * @param {object|null} user auth users 문서 (emailVerificationTime 확인용)
 * @param {Array<{provider?: string}>} accounts 이 사용자의 authAccounts 문서들
 * @returns {boolean}
 */
export function isVerifiedAdmin(adminRow, user, accounts) {
  if (!adminRow) return false;
  const hasVerifiedProvider = (accounts || []).some(
    (a) => a && VERIFIED_PROVIDERS.includes(a.provider),
  );
  const emailVerified = typeof (user || {}).emailVerificationTime === "number";
  return hasVerifiedProvider || emailVerified;
}
