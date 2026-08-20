/* 개인정보 보유기간 집행 — 방침이 약속한 자동파기를 실제로 수행한다(crons.ts가 매일 호출).
   판정 규칙(순수 로직)은 lib/retention.js 참조. 여기서는 조회·삭제만 담당한다.
   한 번에 지우는 양에 상한을 둔다 — Convex 뮤테이션 1회의 읽기/쓰기 한도 안쪽에서 안전하게. */
import { internalMutation } from "./_generated/server";
import {
  shouldPurgeContactMessage,
  shouldPurgeRateRow,
  MAX_RETENTION_MS,
  RATE_RETENTION_MS,
} from "./lib/retention.js";

const BATCH = 200;

export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // 문의 메시지 — 상한(365일)을 넘겼거나, 처리 완료 후 여유기간이 지난 것.
    // by_creation_time 내장 인덱스로 오래된 것부터 훑는다(전체 스캔 방지).
    const oldMessages = await ctx.db
      .query("contactMessages")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - MAX_RETENTION_MS))
      .take(BATCH);
    const handledMessages = await ctx.db
      .query("contactMessages")
      .withIndex("by_handled", (q) => q.eq("handled", true))
      .take(BATCH);
    const toDelete = new Map<string, { _id: unknown }>();
    for (const m of [...oldMessages, ...handledMessages]) {
      if (shouldPurgeContactMessage(m, now)) toDelete.set(String(m._id), m);
    }
    for (const m of toDelete.values()) await ctx.db.delete(m._id as never);

    // 분당 카운터 위생 정리
    const staleRates = await ctx.db
      .query("contactRate")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - RATE_RETENTION_MS))
      .take(BATCH);
    let rateDeleted = 0;
    for (const r of staleRates) {
      if (shouldPurgeRateRow(r, now)) {
        await ctx.db.delete(r._id);
        rateDeleted++;
      }
    }

    return { messagesDeleted: toDelete.size, rateDeleted };
  },
});
