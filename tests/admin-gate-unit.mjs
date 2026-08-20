/* 관리자 판정 순수 로직 단위 테스트 — 권한상승 회귀 방지.
   재현하는 버그: 비밀번호 가입은 이메일 소유 확인이 없으므로, adminUsers에 등재된
   이메일을 제3자가 먼저 비밀번호로 가입해도 관리자가 되면 안 된다(2026-08-21 감사).
   사용: node tests/admin-gate-unit.mjs */
import assert from "node:assert/strict";
import { isVerifiedAdmin, VERIFIED_PROVIDERS } from "../convex/lib/adminGate.js";

const adminRow = { email: "admin@example.com" };

// ① 화이트리스트에 없으면 무조건 false
assert.equal(isVerifiedAdmin(null, { emailVerificationTime: 1 }, [{ provider: "google" }]), false,
  "adminUsers 미등재는 어떤 인증수단이어도 관리자가 아니다");

// ② 핵심 공격 시나리오: 등재 이메일 + 비밀번호 선점 가입(소유 미검증) → false
assert.equal(isVerifiedAdmin(adminRow, {}, [{ provider: "password" }]), false,
  "비밀번호 선점 가입으로는 관리자가 될 수 없다");
assert.equal(isVerifiedAdmin(adminRow, {}, []), false,
  "인증수단이 없으면 관리자가 아니다");
assert.equal(isVerifiedAdmin(adminRow, null, null), false,
  "user/accounts가 비어도 안전하게 false");

// ③ 정상 경로: 등재 이메일 + 구글 OAuth(소유 검증) → true
assert.equal(isVerifiedAdmin(adminRow, {}, [{ provider: "google" }]), true,
  "구글 OAuth 계정은 이메일 소유가 검증되므로 관리자 인정");
assert.equal(isVerifiedAdmin(adminRow, {}, [{ provider: "password" }, { provider: "google" }]), true,
  "비밀번호+구글 병행 계정도 구글 연결이 있으면 인정");

// ④ 향후 이메일 인증 플로: emailVerificationTime이 찍힌 계정 → true
assert.equal(isVerifiedAdmin(adminRow, { emailVerificationTime: 1724198400000 }, [{ provider: "password" }]), true,
  "이메일 인증을 마친 계정은 비밀번호 가입이어도 인정");
assert.equal(isVerifiedAdmin(adminRow, { emailVerificationTime: "not-a-number" }, []), false,
  "emailVerificationTime은 숫자일 때만 인정");

// ⑤ 화이트리스트 상수 자체의 회귀 방지 — password가 끼어들면 안 된다
assert.ok(!VERIFIED_PROVIDERS.includes("password"), "password는 검증된 공급자가 아니다");
assert.ok(VERIFIED_PROVIDERS.includes("google"), "google은 검증된 공급자다");

console.log("✅ admin-gate-unit — 10개 단언 전부 통과");
