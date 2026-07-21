-- 회원 프로필 + 요금제 플래그 (auth.users 1:1)
-- 적용: Supabase 프로젝트 생성 후 이 파일을 그대로 실행 (MCP apply_migration 또는 SQL Editor)

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  plan_expires_at timestamptz,          -- 정기결제 연동 전에는 수동 부여 시 만료일 기록
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 본인 행만 조회 가능. 쓰기는 서버(서비스롤/결제 웹훅)만 — 클라이언트 update 정책 없음(플랜 자가승급 차단).
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- 가입 시 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 유효 플랜 판정(만료 반영)은 클라이언트가 select 후 계산: plan='premium' and (plan_expires_at is null or > now())
