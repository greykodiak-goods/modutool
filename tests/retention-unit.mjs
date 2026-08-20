/* 개인정보 보유기간 판정 단위 테스트 — 방침 약속(처리 후 파기, 늦어도 1년)의 회귀 방지.
   사용: node tests/retention-unit.mjs */
import assert from "node:assert/strict";
import {
  shouldPurgeContactMessage,
  shouldPurgeRateRow,
  DAY_MS,
  HANDLED_GRACE_MS,
  MAX_RETENTION_MS,
} from "../convex/lib/retention.js";

const now = 1_755_800_000_000; // 고정 시각 — 테스트가 실행 시점에 좌우되지 않게

// ① 미처리 문의는 1년 상한 전까지 보관
assert.equal(shouldPurgeContactMessage({ _creationTime: now - 100 * DAY_MS, handled: false }, now), false,
  "미처리 100일 문의는 아직 보관");
assert.equal(shouldPurgeContactMessage({ _creationTime: now - MAX_RETENTION_MS, handled: false }, now), true,
  "미처리라도 365일이 되면 파기(방침 상한)");
assert.equal(shouldPurgeContactMessage({ _creationTime: now - 400 * DAY_MS, handled: false }, now), true,
  "1년 초과분은 파기");

// ② 처리 완료 문의는 여유 30일 후 파기
assert.equal(shouldPurgeContactMessage({ _creationTime: now - 10 * DAY_MS, handled: true }, now), false,
  "처리 완료 10일째는 아직 보관(여유기간)");
assert.equal(shouldPurgeContactMessage({ _creationTime: now - HANDLED_GRACE_MS, handled: true }, now), true,
  "처리 완료 30일이 되면 파기");

// ③ 경계 직전은 보관
assert.equal(shouldPurgeContactMessage({ _creationTime: now - MAX_RETENTION_MS + 1, handled: false }, now), false,
  "365일 하루 전은 보관");

// ④ 분당 카운터는 2일 후 정리
assert.equal(shouldPurgeRateRow({ _creationTime: now - 1 * DAY_MS }, now), false, "1일짜리 카운터는 보관");
assert.equal(shouldPurgeRateRow({ _creationTime: now - 3 * DAY_MS }, now), true, "3일짜리 카운터는 정리");

console.log("✅ retention-unit — 8개 단언 전부 통과");
