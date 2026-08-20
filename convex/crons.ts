/* 예약 작업 — Convex 내장 cron(라이브러리 기능)을 쓴다. 자체 스케줄러를 만들지 않는다.
   매일 1회 개인정보 보유기간을 집행한다(retention.ts). 18:30 UTC = 03:30 KST(한산한 시간). */
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "purge expired contact data",
  { hourUTC: 18, minuteUTC: 30 },
  internal.retention.purgeExpired,
);

export default crons;
