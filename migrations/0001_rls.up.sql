-- S2 · Row-level security that a user token cannot talk its way around.
--
-- profiles   SELECT own row. UPDATE own row, but every billing column is
--            server-only: a BEFORE UPDATE trigger raises when the request
--            arrived with a user (or anon) JWT and a protected column changed.
--            INSERT only through the signup trigger; no DELETE (the row goes
--            with auth.users on delete cascade).
-- watchlists Every verb on own rows only. Row cap: free 10, pro 200, checked
--            by an AFTER … FOR EACH STATEMENT trigger. A per-row BEFORE trigger
--            would not do: rows inserted earlier by the same multi-row INSERT
--            (the client's upsert of a merged list) are invisible to it, so
--            one statement could add 500 rows past the cap.
-- is_pro()   The one definition of "this account is Pro". Every gate — the
--            API, the watchlist cap, the client badge — asks this.

-- ---------------------------------------------------------------- is_pro ---
-- plan = 'pro' and either no expiry (a manual or lifetime grant) or an expiry
-- still ahead. SECURITY INVOKER on purpose: under RLS a user can only answer
-- the question about themselves; the service role and the SQL editor see all.
create or replace function public.is_pro(uid uuid default auth.uid())
returns boolean
language sql stable security invoker set search_path = public as $$
  select coalesce(
    (select p.plan = 'pro' and (p.plan_expires is null or p.plan_expires > now())
       from public.profiles p where p.id = uid),
    false)
$$;
revoke execute on function public.is_pro(uuid) from public, anon;
grant execute on function public.is_pro(uuid) to authenticated, service_role;
comment on function public.is_pro(uuid) is
  'plan = pro and (plan_expires is null or in the future). NULL expiry means an open-ended (manual/lifetime) grant.';

-- -------------------------------------------------------------- profiles ---
alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- no INSERT / DELETE policy for the API roles; the anon key has no business
-- on this table at all
revoke all on public.profiles from anon;
revoke insert, delete on public.profiles from authenticated;

-- Columns only the server writes. `email` is included: the alert digest mails
-- profiles.email, so a user rewriting it would redirect someone else's mail.
-- A column a future feature lets users edit is added to the table and left
-- out of this list.
create or replace function public.profiles_guard_columns()
returns trigger language plpgsql as $$
declare
  jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
begin
  -- No JWT at all is a direct database connection (SQL editor, psql, a
  -- migration). Anything that came through the API with a key other than the
  -- service key is a user.
  if jwt_role is null or jwt_role = 'service_role' then
    return new;
  end if;
  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.plan is distinct from old.plan
     or new.plan_expires is distinct from old.plan_expires
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'profiles: plan and billing columns are written by the server only'
      using errcode = '42501', hint = 'profiles-server-only';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_columns();

-- Signup: one profile per auth user, plan free, never a duplicate.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, plan)
  values (new.id, new.email, 'free')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step with auth.users (a confirmed change of address,
-- a Google sign-in that fills the email in later).
create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ------------------------------------------------------------ watchlists ---
alter table public.watchlists enable row level security;

drop policy if exists "own watchlist" on public.watchlists;
drop policy if exists watchlists_select_own on public.watchlists;
drop policy if exists watchlists_insert_own on public.watchlists;
drop policy if exists watchlists_update_own on public.watchlists;
drop policy if exists watchlists_delete_own on public.watchlists;
create policy watchlists_select_own on public.watchlists
  for select to authenticated using (auth.uid() = user_id);
create policy watchlists_insert_own on public.watchlists
  for insert to authenticated with check (auth.uid() = user_id);
create policy watchlists_update_own on public.watchlists
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy watchlists_delete_own on public.watchlists
  for delete to authenticated using (auth.uid() = user_id);
revoke all on public.watchlists from anon;

-- Row cap. Counted after the statement, per user touched by it, so a
-- multi-row insert is judged on its total. The advisory lock serialises two
-- concurrent inserts for the same user.
create or replace function public.watchlists_cap()
returns int language sql immutable as $$ select 10 $$;
create or replace function public.watchlists_cap_pro()
returns int language sql immutable as $$ select 200 $$;

create or replace function public.watchlists_enforce_cap()
returns trigger language plpgsql as $$
declare
  u uuid;
  n int;
  cap int;
begin
  for u in select distinct user_id from inserted loop
    perform pg_advisory_xact_lock(hashtext('watchlists:' || u::text));
    cap := case when public.is_pro(u) then public.watchlists_cap_pro() else public.watchlists_cap() end;
    select count(*) into n from public.watchlists w where w.user_id = u;
    if n > cap then
      raise exception 'watchlist limit: % rows allowed on this plan, % after this change', cap, n
        using errcode = 'P0001', hint = 'watchlist-cap';
    end if;
  end loop;
  return null;
end $$;

drop trigger if exists watchlists_10_cap on public.watchlists;
create trigger watchlists_10_cap
  after insert on public.watchlists
  referencing new table as inserted
  for each statement execute function public.watchlists_enforce_cap();
