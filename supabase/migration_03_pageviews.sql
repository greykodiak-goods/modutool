-- 자체 방문 분석: outcome 'view' 추가 + 대시보드 v2 (트래픽/도구결과 분리)
-- 프라이버시: 쿠키·핑거프린팅 없음. 리퍼러는 도메인만(meta.ref), 익명 세션ID(기존 난수) 재사용.
-- 적용: 2026-07-23 (execute_sql — migration API 타임아웃으로 이력 대신 본 파일 보존)

alter table public.tool_events drop constraint if exists tool_events_outcome_check;
alter table public.tool_events add constraint tool_events_outcome_check
  check (outcome in ('success','no_result','error','unsupported','cancelled','view'));

drop policy if exists "tool_events_insert_client" on public.tool_events;
create policy "tool_events_insert_client" on public.tool_events
  for insert to anon, authenticated
  with check (
    char_length(tool) between 1 and 40
    and outcome in ('success','no_result','error','unsupported','cancelled','view')
    and (reason is null or char_length(reason) <= 60)
    and pg_column_size(meta) <= 2000
  );

-- 대시보드 v2: view는 트래픽 지표로 분리, 실패율 계산에서 제외
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
    'total', (select count(*) from tool_events where created_at >= since and outcome <> 'view'),
    'fail_total', (select count(*) from tool_events where created_at >= since and outcome not in ('success','view')),
    'views_total', (select count(*) from tool_events where created_at >= since and outcome = 'view'),
    'visitors_est', (select count(distinct session_id) from tool_events where created_at >= since and outcome = 'view' and session_id is not null),
    'by_outcome', coalesce((
      select jsonb_object_agg(outcome, c) from (
        select outcome, count(*) c from tool_events where created_at >= since and outcome <> 'view' group by outcome
      ) t), '{}'::jsonb),
    'by_tool', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select tool,
               count(*) total,
               count(*) filter (where outcome = 'success') success,
               count(*) filter (where outcome <> 'success') failed
        from tool_events where created_at >= since and outcome <> 'view'
        group by tool
        order by count(*) filter (where outcome <> 'success') desc, count(*) desc
      ) t), '[]'::jsonb),
    'top_pages', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select tool as page, count(*) views, count(distinct session_id) sessions,
               count(*) filter (where lang = 'ko') ko, count(*) filter (where lang = 'en') en
        from tool_events where created_at >= since and outcome = 'view'
        group by tool order by count(*) desc limit 30
      ) t), '[]'::jsonb),
    'top_refs', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select coalesce(meta->>'ref','(direct)') ref, count(*) c
        from tool_events where created_at >= since and outcome = 'view'
        group by 1 order by count(*) desc limit 15
      ) t), '[]'::jsonb),
    'views_daily', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') ymd, count(*) views
        from tool_events where created_at >= since and outcome = 'view'
        group by 1 order by 1
      ) t), '[]'::jsonb),
    'top_reasons', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select tool, outcome, coalesce(reason, '(none)') reason, count(*) c
        from tool_events where created_at >= since and outcome not in ('success','view')
        group by tool, outcome, coalesce(reason, '(none)')
        order by count(*) desc limit 30
      ) t), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') ymd,
               count(*) total,
               count(*) filter (where outcome not in ('success','view')) failed
        from tool_events where created_at >= since and outcome <> 'view'
        group by 1 order by 1
      ) t), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select to_char(created_at, 'YYYY-MM-DD HH24:MI') ts, tool, outcome, reason, lang, meta
        from tool_events where outcome not in ('success','view')
        order by created_at desc limit 50
      ) t), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;
