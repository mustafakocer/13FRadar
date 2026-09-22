-- 13F Radar SaaS schema (applied to the Supabase project via MCP/dashboard)

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  plan text not null default 'free',
  plan_expires timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);
-- existing databases: add the billing columns (safe to re-run)
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles
  for select using (auth.uid() = id);

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
create policy "own watchlist" on public.watchlists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- alerts ---
-- alerts and notification_prefs are defined by migrations/0004_alerts.up.sql
-- (opt-in digest preference, filing/insider targets, RLS, row cap). This file
-- is the pre-migration baseline; apply the migrations/ directory on top.
