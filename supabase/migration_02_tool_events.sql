-- 익명 결과 로그 (오작동/미달성 통계용 백오피스) — 적용: 2026-07-22 (프로젝트 gysvtgnpacqjpdijbcaw)
-- ⚠️ 개인정보·파일 원문·사용자 입력값은 절대 저장하지 않는다.
--    도구 슬러그·결과유형·사유코드·크기버킷 등 비식별 메타만 기록한다("파일은 브라우저를 떠나지 않는다"는 약속 유지).

create table if not exists public.tool_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tool text not null check (char_length(tool) between 1 and 40),
  outcome text not null check (outcome in ('success','no_result','error','unsupported','cancelled')),
  reason text check (reason is null or char_length(reason) <= 60),
  lang text check (lang is null or lang in ('ko','en')),
  site text check (site is null or char_length(site) <= 12),
  ua text check (ua is null or char_length(ua) <= 40),
  session_id text check (session_id is null or char_length(session_id) <= 40),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists tool_events_created_idx on public.tool_events (created_at desc);
create index if not exists tool_events_tool_outcome_idx on public.tool_events (tool, outcome);

alter table public.tool_events enable row level security;

-- 익명/로그인 클라이언트는 INSERT만. 조회·수정·삭제 정책 없음 → 클라이언트로 로그 열람 불가.
grant insert on public.tool_events to anon, authenticated;

create policy "tool_events_insert_client" on public.tool_events
  for insert to anon, authenticated
  with check (
    char_length(tool) between 1 and 40
    and outcome in ('success','no_result','error','unsupported','cancelled')
    and (reason is null or char_length(reason) <= 60)
    and pg_column_size(meta) <= 2000
  );

-- ── 관리자 화이트리스트 (백오피스 접근용) ──
create table if not exists public.admin_users (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
-- 정책 없음: SECURITY DEFINER 함수만 참조. 클라이언트 직접 접근 불가.
-- 관리자 추가: insert into public.admin_users(email) values ('someone@example.com');

insert into public.admin_users (email) values ('greykodiak1@gmail.com')
  on conflict (email) do nothing;

create or replace function public.mdtl_is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admin_users a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 백오피스 대시보드 집계 (관리자만). days = 최근 며칠(1~365).
create or replace function public.mdtl_tool_dashboard(days int default 30)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(days, 30), 365)));
  result jsonb;
begin
  if not public.mdtl_is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'since', since,
    'generated_at', now(),
    'total', (select count(*) from tool_events where created_at >= since),
    'fail_total', (select count(*) from tool_events where created_at >= since and outcome <> 'success'),
    'by_outcome', coalesce((
      select jsonb_object_agg(outcome, c) from (
        select outcome, count(*) c from tool_events where created_at >= since group by outcome
      ) t), '{}'::jsonb),
    'by_tool', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select tool,
               count(*) total,
               count(*) filter (where outcome = 'success') success,
               count(*) filter (where outcome <> 'success') failed
        from tool_events where created_at >= since
        group by tool
        order by count(*) filter (where outcome <> 'success') desc, count(*) desc
      ) t), '[]'::jsonb),
    'top_reasons', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select tool, outcome, coalesce(reason, '(none)') reason, count(*) c
        from tool_events where created_at >= since and outcome <> 'success'
        group by tool, outcome, coalesce(reason, '(none)')
        order by count(*) desc limit 30
      ) t), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') ymd,
               count(*) total,
               count(*) filter (where outcome <> 'success') failed
        from tool_events where created_at >= since
        group by 1 order by 1
      ) t), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select to_char(created_at, 'YYYY-MM-DD HH24:MI') ts, tool, outcome, reason, lang, meta
        from tool_events where outcome <> 'success'
        order by created_at desc limit 50
      ) t), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.mdtl_tool_dashboard(int) from public, anon;
grant execute on function public.mdtl_tool_dashboard(int) to authenticated;
