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
-- Saved alerts and how a reader wants to hear about them. Delivery state
-- (last_fired_at, last_seen_filed) lives on the row so a digest job that runs
-- twice in a day does not send the same filing twice.

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users on delete cascade,
  email_enabled boolean not null default true,
  -- 'daily' or 'weekly'; a reader who wants neither turns email_enabled off
  cadence text not null default 'daily',
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy "own notification prefs" on public.notification_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  -- 'filing'  a watched filer files a new 13F
  -- 'insider' the insider feed matches a saved set of filters
  kind text not null,
  label text not null,
  params jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  -- the newest thing already reported, so a re-run repeats nothing
  last_seen text,
  last_fired_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.alerts enable row level security;
create policy "own alerts" on public.alerts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists alerts_user_enabled on public.alerts (user_id) where enabled;
