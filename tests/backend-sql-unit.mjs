/* 백엔드 불변식 단위검사 — Supabase 재이관(2026-08-22) 후 보존·관리자·수집 로직은 전부
   SQL(supabase/migrations/)에 산다. 구 convex/lib 단위테스트(retention-unit, admin-gate-unit)가
   지키던 사업 불변식을 SQL 정본에서 그대로 검증한다. 정의를 바꾸면 운영 적용 → 기록 갱신 →
   이 테스트가 따라오게 하는 게 목적이다(래칫 유지 — 테스트를 지워 통과시키지 않는다). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sql = readFileSync(join(root, 'supabase/migrations/2026-08-22_tim_backend_from_convex.sql'), 'utf8');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };

/* ── 보존 정책 (구 retention-unit 의 불변식) ── */
const purge = sql.match(/FUNCTION public\.tim_purge_expired\(\)[\s\S]*?\$function\$;/)[0];
ok(/interval '365 days'/.test(purge), '문의 보존 상한 365일');
ok(/handled and created_at < now\(\) - interval '30 days'/.test(purge), '처리 완료 문의는 30일 후 삭제');
ok(/tim_contact_rate where created_at < now\(\) - interval '2 days'/.test(purge), '레이트 카운터는 2일 후 삭제');
ok(/cron\.schedule\('tim-retention-daily', '30 18 \* \* \*'/.test(sql), '보존 크론이 매일 18:30 UTC 등록');

/* ── 관리자 게이트 (구 admin-gate-unit 의 불변식) ── */
const gate = sql.match(/FUNCTION public\.tim_is_admin\(\)[\s\S]*?\$function\$;/)[0];
ok(/auth\.uid\(\)/.test(gate), '관리자 판정은 인증된 uid 기준');
ok(/email_confirmed_at is not null/.test(gate), '이메일 미확인 계정은 관리자가 될 수 없음');
ok(/a\.email = lower\(u\.email\)/.test(gate), '이메일 대소문자 정규화 후 대조');

/* ── 수집 검증 (프라이버시 계약의 서버 강제력) ── */
const log = sql.match(/FUNCTION public\.tim_log_event\(p jsonb\)[\s\S]*?\$function\$;/)[0];
ok(/'success','no_result','error','unsupported','cancelled','view'/.test(log), 'outcome 화이트리스트 6종');
const metaKeys = log.match(/where key in \(([\s\S]*?)\)/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
ok(metaKeys.length === 18 && metaKeys.includes('utm_source') && !metaKeys.includes('filename'),
  `meta 화이트리스트 18키·filename 불허 (실제 ${metaKeys.length}키)`);
ok(/left\(value #>> '\{\}', 40\)/.test(log), 'meta 문자열 40자 절단');
ok(/p->>'sessionId', p->>'session_id'/.test(log), 'sessionId/session_id 양표기 수용');
ok(/on conflict \(ymd, tool, outcome\) do update set count = s\.count \+ 1/.test(log), '일별 롤업 원자 증분');

/* ── 문의 검증 ── */
const contact = sql.match(/FUNCTION public\.tim_submit_contact\(p jsonb\)[\s\S]*?\$function\$;/)[0];
ok(/hp'\),''\) <> '' then return jsonb_build_object\('ok', true\)/.test(contact), '허니팟: 봇에게 성공 위장·무적재');
ok(/v_count > 20 then return jsonb_build_object\('ok', false, 'code', 'rate_limited'\)/.test(contact), '분당 20건 상한 → rate_limited JSON');
ok(/v_email := null/.test(contact), '형식 불량 이메일은 null 저장(거절 아님)');

/* ── 권한 계약 ──
   [기대값 변경 2026-08-22] 원래 '스키마 광역 revoke'를 불변식으로 단언했으나, 그 광역 revoke가
   공유 인스턴스의 어닝하우스·딥마진 전 권한을 제거해 전면 장애를 냈다(05:52 UTC 실사고).
   불변식의 본질은 "tim_ 테이블 직접 접근 차단"이므로 tim_ 명시 나열로 재표현하고,
   위험 패턴(ON ALL ... IN SCHEMA)은 부재를 역으로 단언한다 — 재등장 시 CI가 막는다. */
ok(/revoke all on table tim_profiles[\s\S]{0,200}?tim_admin_users from anon, authenticated/.test(sql), 'tim_ 테이블 직접 접근 차단(명시 나열)');
ok(!/on\s+all\s+(tables|functions|sequences)\s+in\s+schema/i.test(sql), '스키마 광역 권한 변경 부재(공유 DB — 2026-08-22 사고 재발 방지)');
ok(/grant execute on function tim_log_event\(jsonb\), tim_submit_contact\(jsonb\) to anon/.test(sql), 'anon 은 수집·문의 RPC 만');

console.log(`✅ backend-sql-unit — ${n}개 단언 전부 통과`);
