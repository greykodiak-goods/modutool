/* 개인정보 보유기간 판정의 순수 로직 — tests/retention-unit.mjs 에서 검증.
   방침(privacy) 약속: 문의는 처리가 끝나면 파기하고, 늦어도 접수 후 1년에는 파기한다.
   집행 규칙:
   · 처리 완료(handled)된 문의 → 완료 후 검토 여유 30일이 지나면 파기
   · 처리 여부와 무관하게 접수 후 365일이 지나면 파기 (방침의 상한)
   · contactRate(분당 카운터)는 개인정보는 아니지만 2일 지나면 정리(위생) */

export const DAY_MS = 86_400_000;
export const HANDLED_GRACE_MS = 30 * DAY_MS;
export const MAX_RETENTION_MS = 365 * DAY_MS;
export const RATE_RETENTION_MS = 2 * DAY_MS;

/**
 * 문의 메시지를 지금 파기해야 하는지 판정한다.
 * @param {{_creationTime: number, handled: boolean}} msg
 * @param {number} now ms epoch
 * @returns {boolean}
 */
export function shouldPurgeContactMessage(msg, now) {
  const age = now - msg._creationTime;
  if (age >= MAX_RETENTION_MS) return true;
  return !!msg.handled && age >= HANDLED_GRACE_MS;
}

/**
 * 분당 카운터 행을 정리해야 하는지 판정한다.
 * @param {{_creationTime: number}} row
 * @param {number} now ms epoch
 * @returns {boolean}
 */
export function shouldPurgeRateRow(row, now) {
  return now - row._creationTime >= RATE_RETENTION_MS;
}
