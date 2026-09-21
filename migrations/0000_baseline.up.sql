-- Baseline: what the production project already holds (2026-09-21), written
-- idempotently so it can be applied to an empty database for local tests and
-- re-run on the live one as a no-op. Live state was: profiles (id, email,
-- plan, plan_expires, ls_customer_id, created_at, stripe_customer_id,
-- stripe_subscription_id) and watchlists (user_id, cik, name, created_at),
-- RLS on both, one SELECT policy on profiles, one FOR ALL policy on
-- watchlists, and the signup trigger.

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  plan text not null default 'free',
  plan_expires timestamptz,
  ls_customer_id text,
  created_at timestamptz not null default now(),
  stripe_customer_id text,
  stripe_subscription_id text
);
alter table public.profiles add column if not exists ls_customer_id text;
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'read own profile') then
    create policy "read own profile" on public.profiles for select using (auth.uid() = id);
  end if;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table if not exists public.watchlists (
  user_id uuid not null references auth.users on delete cascade,
  cik text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, cik)
);
alter table public.watchlists enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'watchlists' and policyname = 'own watchlist') then
    create policy "own watchlist" on public.watchlists
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
