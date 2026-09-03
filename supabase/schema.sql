-- 13F Radar SaaS schema (applied to the Supabase project via MCP/dashboard)

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  plan text not null default 'free',
  plan_expires timestamptz,
  ls_customer_id text,
  created_at timestamptz not null default now()
);
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

-- ---------------------------------------------------------------------------
-- Alerts (P0-3): users follow funds / stocks and get an email when a new 13F
-- for a followed fund is ingested. Deliveries are unique per filing so a
-- notification is never sent twice.
create table if not exists public.alert_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('fund', 'stock')),
  key text not null,            -- 10-digit CIK for funds, 9-char CUSIP for stocks
  label text,
  channel text not null default 'email' check (channel in ('email')),
  created_at timestamptz not null default now(),
  unique (user_id, kind, key)
);
alter table public.alert_subscriptions enable row level security;
create policy "own alert subscriptions" on public.alert_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists alert_subscriptions_kind_key on public.alert_subscriptions (kind, key);

create table if not exists public.alert_deliveries (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  key text not null,
  event_id text not null,        -- accession number(s) of the filing that triggered it
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (user_id, kind, key, event_id)
);
alter table public.alert_deliveries enable row level security;
create policy "read own deliveries" on public.alert_deliveries
  for select using (auth.uid() = user_id);
-- writes happen from the sender job with the service role (bypasses RLS)

-- ---------------------------------------------------------------------------
-- Watchlists & fund groups (P0-4)
create table if not exists public.stock_watchlist (
  user_id uuid not null references auth.users on delete cascade,
  cusip text not null,
  ticker text,
  name text,
  created_at timestamptz not null default now(),
  primary key (user_id, cusip)
);
alter table public.stock_watchlist enable row level security;
create policy "own stock watchlist" on public.stock_watchlist
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.fund_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  weighting text not null default 'aum' check (weighting in ('aum', 'equal')),
  created_at timestamptz not null default now()
);
alter table public.fund_groups enable row level security;
create policy "own fund groups" on public.fund_groups
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.fund_group_members (
  group_id uuid not null references public.fund_groups on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  cik text not null,
  name text,
  created_at timestamptz not null default now(),
  primary key (group_id, cik)
);
alter table public.fund_group_members enable row level security;
create policy "own fund group members" on public.fund_group_members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Saved stock screens (P1-8, Pro)
create table if not exists public.saved_screens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.saved_screens enable row level security;
create policy "own saved screens" on public.saved_screens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Read-only REST API keys (P2-13, Pro). Only a SHA-256 hash is stored.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  prefix text not null,               -- first 12 chars, shown in the UI
  key_hash text not null unique,      -- sha256(hex) of the full key
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.api_keys enable row level security;
create policy "own api keys" on public.api_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- the public API validates keys with the service role (bypasses RLS)
