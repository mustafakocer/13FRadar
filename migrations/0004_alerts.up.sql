-- S6 · Alerts and notification preferences — the two tables the account
-- page, the alert hook and the digest job have been reading since S1 and
-- that never existed on the live project (every call answered 404).
--
-- notification_prefs  one row per account: whether the reader wants the
--                     email digest at all (opt-in: default false) and how
--                     often. Created by the signup trigger alongside the
--                     profile; backfilled here for existing accounts.
-- alerts              what a reader is told about: a filer (kind 'filing',
--                     target = 10-digit CIK) or a ticker (kind 'insider',
--                     target = symbol, or '*' for "any, the filters decide").
--                     `filters` is the saved insider filter; `last_seen` /
--                     `last_fired_at` are the digest's high-water mark so a
--                     run repeated the same day reports nothing twice.
--                     One row per (user, kind, target), so "turn on" is
--                     idempotent. Row cap: free 5, pro 100, the same AFTER
--                     … FOR EACH STATEMENT pattern as watchlists_10_cap.
-- RLS                 own rows only, four policies per table; the anon key
--                     has nothing here. The service role bypasses RLS to
--                     read everyone's alerts for the digest.

-- ---------------------------------------------------- notification_prefs ---
create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users on delete cascade,
  email_digest boolean not null default false,
  digest_frequency text not null default 'weekly',
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs drop constraint if exists notification_prefs_frequency_check;
alter table public.notification_prefs add constraint notification_prefs_frequency_check
  check (digest_frequency in ('daily', 'weekly'));
comment on table public.notification_prefs is 'Per-account email digest preference. email_digest is opt-in (default false); one row per auth user, made by the signup trigger.';

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists notification_prefs_touch on public.notification_prefs;
create trigger notification_prefs_touch
  before update on public.notification_prefs
  for each row execute function public.touch_updated_at();

alter table public.notification_prefs enable row level security;
drop policy if exists "own notification prefs" on public.notification_prefs;
drop policy if exists notification_prefs_select_own on public.notification_prefs;
drop policy if exists notification_prefs_insert_own on public.notification_prefs;
drop policy if exists notification_prefs_update_own on public.notification_prefs;
drop policy if exists notification_prefs_delete_own on public.notification_prefs;
create policy notification_prefs_select_own on public.notification_prefs
  for select to authenticated using (auth.uid() = user_id);
create policy notification_prefs_insert_own on public.notification_prefs
  for insert to authenticated with check (auth.uid() = user_id);
create policy notification_prefs_update_own on public.notification_prefs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy notification_prefs_delete_own on public.notification_prefs
  for delete to authenticated using (auth.uid() = user_id);
revoke all on public.notification_prefs from anon;
grant select, insert, update, delete on public.notification_prefs to authenticated, service_role;

-- --------------------------------------------------------------- alerts ---
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null,
  target text not null,
  label text,
  filters jsonb not null default '{}'::jsonb,
  last_seen text,
  last_fired_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.alerts drop constraint if exists alerts_kind_check;
alter table public.alerts add constraint alerts_kind_check check (kind in ('filing', 'insider'));
alter table public.alerts drop constraint if exists alerts_target_check;
alter table public.alerts add constraint alerts_target_check check (
  (kind = 'filing' and target ~ '^[0-9]{10}$')
  or (kind = 'insider' and (target = '*' or target ~ '^[A-Z0-9.\-]{1,12}$'))
);
create unique index if not exists alerts_user_kind_target_key on public.alerts (user_id, kind, target);
create index if not exists alerts_user_id on public.alerts (user_id);
comment on table public.alerts is 'Saved alerts: kind filing (target = CIK) or insider (target = ticker or *, filters = the saved feed filter). last_seen / last_fired_at are the digest high-water mark.';

-- The target arrives however the page had it: pad a CIK, upper-case a ticker.
create or replace function public.alerts_normalize_target()
returns trigger language plpgsql as $$
begin
  new.target := btrim(new.target);
  if new.kind = 'filing' and new.target ~ '^[0-9]{1,10}$' then
    new.target := lpad(new.target, 10, '0');
  elsif new.kind = 'insider' then
    new.target := upper(new.target);
  end if;
  return new;
end $$;
drop trigger if exists alerts_00_normalize_target on public.alerts;
create trigger alerts_00_normalize_target
  before insert or update of target, kind on public.alerts
  for each row execute function public.alerts_normalize_target();

alter table public.alerts enable row level security;
drop policy if exists "own alerts" on public.alerts;
drop policy if exists alerts_select_own on public.alerts;
drop policy if exists alerts_insert_own on public.alerts;
drop policy if exists alerts_update_own on public.alerts;
drop policy if exists alerts_delete_own on public.alerts;
create policy alerts_select_own on public.alerts
  for select to authenticated using (auth.uid() = user_id);
create policy alerts_insert_own on public.alerts
  for insert to authenticated with check (auth.uid() = user_id);
create policy alerts_update_own on public.alerts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy alerts_delete_own on public.alerts
  for delete to authenticated using (auth.uid() = user_id);
revoke all on public.alerts from anon;
grant select, insert, update, delete on public.alerts to authenticated, service_role;

-- Row cap, judged after the statement per user touched (a multi-row insert
-- is one statement; the per-row form would let it past the cap).
create or replace function public.alerts_cap()
returns int language sql immutable as $$ select 5 $$;
create or replace function public.alerts_cap_pro()
returns int language sql immutable as $$ select 100 $$;

create or replace function public.alerts_enforce_cap()
returns trigger language plpgsql as $$
declare
  u uuid;
  n int;
  cap int;
begin
  for u in select distinct user_id from inserted loop
    perform pg_advisory_xact_lock(hashtext('alerts:' || u::text));
    cap := case when public.is_pro(u) then public.alerts_cap_pro() else public.alerts_cap() end;
    select count(*) into n from public.alerts a where a.user_id = u;
    if n > cap then
      raise exception 'alert limit: % alerts allowed on this plan, % after this change', cap, n
        using errcode = 'P0001', hint = 'alert-cap';
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists alerts_05_cap on public.alerts;
create trigger alerts_05_cap
  after insert on public.alerts
  referencing new table as inserted
  for each statement execute function public.alerts_enforce_cap();

-- --------------------------------------------------------------- signup ---
-- One profile and one preference row per auth user. The preference row is
-- opt-in (email_digest false): a new account gets no mail until it asks.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, plan)
  values (new.id, new.email, 'free')
  on conflict (id) do nothing;
  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- accounts that signed up before this table existed
insert into public.notification_prefs (user_id)
select u.id from auth.users u
 where not exists (select 1 from public.notification_prefs p where p.user_id = u.id)
on conflict (user_id) do nothing;
