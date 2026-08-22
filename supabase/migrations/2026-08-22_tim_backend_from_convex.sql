-- tim_ 백엔드 (Convex 이관, A′) — 운영 적용본 기록. 원본 적용: Supabase MCP apply_migration
-- 'tim_backend_from_convex' + 'tim_log_event_session_id_compat' @ wcztgneaqmwfeuonyjny (2026-08-22).
-- 상세 설계: docs/2026-08-22-supabase-migration-loop.md
-- 이 파일은 운영 DB에서 pg_get_functiondef/pg_indexes 로 덤프한 "지금 실제로 돌아가는 정의"다.
-- tests/contract-audit.mjs 가 이 파일의 outcome·meta 화이트리스트를 product-contract/events.yaml 과 대조한다.
-- 정의를 바꾸려면: 운영에 마이그레이션 적용 → 이 기록 갱신 → events.yaml 동기 (같은 커밋).

-- ── 테이블 (전부 RLS on · 정책 0 = 직접 접근 전면 차단, service_role/definer 만 통과) ──

create table if not exists tim_profiles (
  user_id uuid not null primary key,
  email text not null,
  plan text not null default 'free',
  plan_expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tim_profiles_email on tim_profiles (email);

create table if not exists tim_tool_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  tool text not null,
  outcome text not null,
  reason text,
  lang text,
  site text,
  ua text,
  session_id text,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists tim_tool_events_created on tim_tool_events (created_at desc);
create index if not exists tim_tool_events_outcome_created on tim_tool_events (outcome, created_at desc);

create table if not exists tim_daily_stats (
  ymd date not null,
  tool text not null,
  outcome text not null,
  count bigint not null default 0,
  primary key (ymd, tool, outcome)
);

create table if not exists tim_contact_messages (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text,
  subject text not null,
  body text not null,
  lang text,
  site text,
  handled boolean not null default false
);
create index if not exists tim_contact_handled_created on tim_contact_messages (handled, created_at desc);

create table if not exists tim_contact_rate (
  minute text not null primary key,
  count integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists tim_admin_users (
  email text not null primary key
);

alter table tim_profiles enable row level security;
alter table tim_tool_events enable row level security;
alter table tim_daily_stats enable row level security;
alter table tim_contact_messages enable row level security;
alter table tim_contact_rate enable row level security;
alter table tim_admin_users enable row level security;

-- ── RPC (SECURITY DEFINER — 검증·레이트리밋·롤업을 SQL 안에서 원자 처리, 엣지 함수 0개 설계) ──

CREATE OR REPLACE FUNCTION public.tim_is_admin()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from auth.users u
    join tim_admin_users a on a.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$function$;

CREATE OR REPLACE FUNCTION public.tim_log_event(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tool text := left(coalesce(p->>'tool',''), 40);
  v_outcome text;
  v_clean jsonb;
begin
  if v_tool = '' then raise exception 'tool required'; end if;
  v_outcome := case when p->>'outcome' in ('success','no_result','error','unsupported','cancelled','view')
               then p->>'outcome' else 'error' end;
  select coalesce(jsonb_object_agg(key,
           case jsonb_typeof(value)
             when 'string'  then to_jsonb(left(value #>> '{}', 40))
             when 'number'  then to_jsonb(round((value #>> '{}')::numeric, 2))
             when 'boolean' then value
           end), '{}'::jsonb)
    into v_clean
  from jsonb_each(coalesce(p->'meta','{}'::jsonb))
  where key in ('pages','count','n','size_bucket','result_bucket','level','saved_pct','err_name',
                'width','height','format','quality','seed','ref',
                'utm_source','utm_medium','utm_campaign','utm_content')
    and jsonb_typeof(value) in ('string','number','boolean');
  if length(v_clean::text) > 2000 then raise exception 'meta too large'; end if;

  insert into tim_daily_stats as s (ymd, tool, outcome, count)
  values (current_date, v_tool, v_outcome, 1)
  on conflict (ymd, tool, outcome) do update set count = s.count + 1;

  insert into tim_tool_events (tool, outcome, reason, lang, site, ua, session_id, meta)
  values (v_tool, v_outcome,
          nullif(left(coalesce(p->>'reason',''), 60), ''),
          case when p->>'lang' in ('ko','en') then p->>'lang' end,
          nullif(left(coalesce(p->>'site',''), 12), ''),
          nullif(left(coalesce(p->>'ua',''), 40), ''),
          nullif(left(coalesce(p->>'sessionId', p->>'session_id',''), 40), ''),
          v_clean);
end $function$;

CREATE OR REPLACE FUNCTION public.tim_submit_contact(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_subject text := left(btrim(coalesce(p->>'subject','')), 120);
  v_body text := left(btrim(coalesce(p->>'body','')), 4000);
  v_email text;
  v_minute text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI');
  v_count int;
begin
  if coalesce(btrim(p->>'hp'),'') <> '' then return jsonb_build_object('ok', true); end if; -- 허니팟: 봇에게 성공 위장
  if v_subject = '' or v_body = '' then return jsonb_build_object('ok', false, 'code', 'empty'); end if;
  if coalesce(btrim(p->>'email'),'') <> '' then
    v_email := lower(left(btrim(p->>'email'), 200));
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
  end if;

  insert into tim_contact_rate as r (minute, count) values (v_minute, 1)
  on conflict (minute) do update set count = r.count + 1
  returning count into v_count;
  if v_count > 20 then return jsonb_build_object('ok', false, 'code', 'rate_limited'); end if;

  insert into tim_contact_messages (email, subject, body, lang, site)
  values (v_email, v_subject, v_body, left(p->>'lang',5), left(p->>'site',10));
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.tim_ensure_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text; v_plan text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  insert into tim_profiles (user_id, email) values (auth.uid(), coalesce(v_email,''))
  on conflict (user_id) do nothing;
  select plan into v_plan from tim_profiles where user_id = auth.uid();
  return jsonb_build_object('created', found, 'plan', v_plan);
end $function$;

CREATE OR REPLACE FUNCTION public.tim_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u record; pr record;
begin
  if auth.uid() is null then return null; end if;
  select email, raw_user_meta_data->>'name' as name, created_at into u from auth.users where id = auth.uid();
  select plan, plan_expires_at into pr from tim_profiles where user_id = auth.uid();
  return jsonb_build_object(
    'email', coalesce(u.email,''), 'name', u.name,
    'plan', coalesce(pr.plan,'free'),
    'planExpiresAt', case when pr.plan_expires_at is null then null
                          else (extract(epoch from pr.plan_expires_at) * 1000)::bigint end,
    'isAdmin', tim_is_admin(),
    'createdAt', (extract(epoch from u.created_at) * 1000)::bigint);
end $function$;

CREATE OR REPLACE FUNCTION public.tim_delete_account(p_confirm_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_email text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if lower(btrim(p_confirm_email)) is distinct from v_email then raise exception 'email_mismatch'; end if;
  delete from auth.users where id = auth.uid();
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.tim_dashboard(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_days int := greatest(1, least(coalesce(p_days,30), 365));
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days,30), 365)));
  result jsonb;
begin
  if not tim_is_admin() then raise exception 'forbidden'; end if;

  with roll as (select * from tim_daily_stats where ymd >= v_since::date),
  ev as (select * from tim_tool_events where created_at >= v_since),
  views as (select * from ev where outcome = 'view'),
  jobs as (select * from ev where outcome <> 'view'),
  sess_first_campaign as (
    select distinct on (session_id) session_id,
      concat_ws(' / ', meta->>'utm_source', meta->>'utm_medium', meta->>'utm_campaign') as campaign
    from views where session_id is not null and meta ? 'utm_source'
    order by session_id, created_at
  ),
  campaign_views as (
    select concat_ws(' / ', meta->>'utm_source', meta->>'utm_medium', meta->>'utm_campaign') as campaign,
           count(*) as views, count(distinct session_id) as sessions
    from views where meta ? 'utm_source' group by 1
  ),
  campaign_jobs as (
    select sc.campaign, count(*) as jobs, count(*) filter (where j.outcome = 'success') as success
    from jobs j join sess_first_campaign sc on sc.session_id = j.session_id
    group by sc.campaign
  )
  select jsonb_build_object(
    'since', to_char(v_since at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'generated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sampled', false,
    'scan_cap', null,
    'total', coalesce((select sum(count) from roll where outcome <> 'view'), 0),
    'fail_total', coalesce((select sum(count) from roll where outcome not in ('view','success')), 0),
    'views_total', coalesce((select sum(count) from roll where outcome = 'view'), 0),
    'visitors_est', (select count(distinct session_id) from views where session_id is not null),
    'by_outcome', coalesce((select jsonb_object_agg(outcome, s) from
      (select outcome, sum(count) as s from roll where outcome <> 'view' group by outcome) x), '{}'::jsonb),
    'by_tool', coalesce((select jsonb_agg(jsonb_build_object('tool', tool, 'total', total, 'success', success, 'failed', failed) order by failed desc, total desc) from
      (select tool, sum(count) as total,
              sum(count) filter (where outcome = 'success') as success,
              sum(count) filter (where outcome <> 'success') as failed
       from roll where outcome <> 'view' group by tool) x), '[]'::jsonb),
    'top_pages', coalesce((select jsonb_agg(jsonb_build_object('page', tool, 'views', views, 'sessions', sessions, 'ko', ko, 'en', en) order by views desc) from
      (select tool, count(*) as views, count(distinct session_id) as sessions,
              count(*) filter (where lang = 'ko') as ko, count(*) filter (where lang = 'en') as en
       from views group by tool order by count(*) desc limit 30) x), '[]'::jsonb),
    'top_refs', coalesce((select jsonb_agg(jsonb_build_object('ref', ref, 'c', c) order by c desc) from
      (select coalesce(meta->>'ref','(direct)') as ref, count(*) as c
       from views group by 1 order by count(*) desc limit 15) x), '[]'::jsonb),
    'top_campaigns', coalesce((select jsonb_agg(jsonb_build_object('campaign', v.campaign, 'views', v.views, 'sessions', v.sessions,
        'jobs', coalesce(j.jobs,0), 'success', coalesce(j.success,0)) order by coalesce(j.success,0) desc, v.views desc) from
      campaign_views v left join campaign_jobs j on j.campaign = v.campaign), '[]'::jsonb),
    'views_daily', coalesce((select jsonb_agg(jsonb_build_object('ymd', ymd, 'views', v) order by ymd) from
      (select to_char(ymd,'YYYY-MM-DD') as ymd, sum(count) as v from roll where outcome = 'view' group by ymd) x), '[]'::jsonb),
    'top_reasons', coalesce((select jsonb_agg(jsonb_build_object('tool', tool, 'outcome', outcome, 'reason', reason, 'c', c) order by c desc) from
      (select tool, outcome, coalesce(reason,'(none)') as reason, count(*) as c
       from jobs where outcome <> 'success' group by tool, outcome, reason order by count(*) desc limit 30) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('ymd', ymd, 'total', total, 'failed', failed) order by ymd) from
      (select to_char(ymd,'YYYY-MM-DD') as ymd, sum(count) as total,
              sum(count) filter (where outcome <> 'success') as failed
       from roll where outcome <> 'view' group by ymd) x), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('ts', ts, 'tool', tool, 'outcome', outcome, 'reason', reason, 'lang', lang, 'meta', meta)) from
      (select to_char(created_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') as ts, tool, outcome, reason, lang, meta
       from jobs where outcome <> 'success' order by created_at desc limit 50) x), '[]'::jsonb)
  ) into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.tim_contact_list(p_only_unhandled boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not tim_is_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'at', (extract(epoch from created_at) * 1000)::bigint,
      'email', email, 'subject', subject, 'body', body,
      'lang', lang, 'site', site, 'handled', handled) order by created_at desc) from
    (select * from tim_contact_messages
     where (not p_only_unhandled) or handled = false
     order by created_at desc limit 200) x), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.tim_contact_set_handled(p_id bigint, p_handled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not tim_is_admin() then raise exception 'forbidden'; end if;
  update tim_contact_messages set handled = p_handled where id = p_id;
  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.tim_purge_expired()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n_msg int; n_rate int;
begin
  delete from tim_contact_messages
  where created_at < now() - interval '365 days'
     or (handled and created_at < now() - interval '30 days');
  get diagnostics n_msg = row_count;
  delete from tim_contact_rate where created_at < now() - interval '2 days';
  get diagnostics n_rate = row_count;
  return jsonb_build_object('messages', n_msg, 'rate_rows', n_rate);
end $function$;

-- ── 권한: 테이블 직접 접근 전면 차단, RPC 만 선별 grant ──
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated;
grant execute on function tim_log_event(jsonb), tim_submit_contact(jsonb) to anon, authenticated;
grant execute on function tim_is_admin(), tim_ensure_profile(), tim_me(), tim_delete_account(text),
  tim_dashboard(integer), tim_contact_list(boolean), tim_contact_set_handled(bigint, boolean)
  to authenticated;

-- ── 보존 크론 (pg_cron): 365일 상한 · handled+30일 · rate 2일 ──
select cron.schedule('tim-retention-daily', '30 18 * * *', $$select tim_purge_expired()$$);
