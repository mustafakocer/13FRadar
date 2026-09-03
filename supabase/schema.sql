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
