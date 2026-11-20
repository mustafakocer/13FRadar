-- S9 · Stripe events applied in the order they happened, not the order they
-- arrived.
--
-- Stripe does not order its deliveries: a customer.subscription.updated
-- (active) can arrive after the customer.subscription.deleted that followed
-- it, and would re-open Pro on a cancelled account. Each profile now remembers
-- the `created` time of the last Stripe event that changed it, and
-- apply_stripe_event ignores a plan-changing event older than that.
--
-- profiles.stripe_event_at   `created` of the last Stripe event applied to
--                            the row. NULL until the first one. Server-only,
--                            like the other billing columns.
-- apply_stripe_event         gains p_event_at (the event's `created`). An
--                            event that would change a profile and is older
--                            than profiles.stripe_event_at is recorded with
--                            outcome 'ignored:stale' and changes nothing. The
--                            row is locked for the comparison, so two
--                            deliveries racing on one profile cannot both
--                            pass it. Equal times are applied: Stripe's clock
--                            has one-second resolution, and a checkout and
--                            its subscription.created share a second.
--                            Called without p_event_at it behaves exactly as
--                            before (no ordering check), which is what a
--                            deployment older than this migration sends.
--
-- Additive and nullable: safe on the live database, no rows are rewritten.
-- Safe to re-run.

alter table public.profiles add column if not exists stripe_event_at timestamptz;
comment on column public.profiles.stripe_event_at is
  '`created` of the last Stripe event applied to this row; older events are ignored (apply_stripe_event).';

-- The guard of 0001 with the new column added to the server-only list.
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
     or new.stripe_event_at is distinct from old.stripe_event_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'profiles: plan and billing columns are written by the server only'
      using errcode = '42501', hint = 'profiles-server-only';
  end if;
  return new;
end $$;

-- One function, not an overload next to the five-argument one: PostgREST
-- cannot choose between two candidates that both fit a call.
drop function if exists public.apply_stripe_event(text, text, uuid, jsonb, text);

create or replace function public.apply_stripe_event(
  p_event_id text,
  p_event_type text,
  p_user_id uuid default null,
  p_patch jsonb default '{}'::jsonb,
  p_outcome text default 'applied',
  p_event_at timestamptz default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  last_at timestamptz;
begin
  if p_event_id is null or p_event_id = '' then
    raise exception 'apply_stripe_event: event id required';
  end if;

  insert into public.stripe_events (id, type, user_id, outcome)
  values (p_event_id, p_event_type, p_user_id, coalesce(p_outcome, 'applied'))
  on conflict (id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if p_user_id is not null and p_patch is not null and p_patch <> '{}'::jsonb then
    select stripe_event_at into last_at from public.profiles where id = p_user_id for update;
    if not found then
      -- the account is gone; remember the event so Stripe is not retried
      -- for three days over a profile that no longer exists
      update public.stripe_events set outcome = 'skipped:no-profile' where id = p_event_id;
      return 'skipped:no-profile';
    end if;
    if p_event_at is not null and last_at is not null and p_event_at < last_at then
      update public.stripe_events set outcome = 'ignored:stale' where id = p_event_id;
      return 'ignored:stale';
    end if;
    update public.profiles set
      plan = case when p_patch ? 'plan' then p_patch ->> 'plan' else plan end,
      plan_expires = case when p_patch ? 'plan_expires' then (p_patch ->> 'plan_expires')::timestamptz else plan_expires end,
      stripe_customer_id = case when p_patch ? 'stripe_customer_id' then p_patch ->> 'stripe_customer_id' else stripe_customer_id end,
      stripe_subscription_id = case when p_patch ? 'stripe_subscription_id' then p_patch ->> 'stripe_subscription_id' else stripe_subscription_id end,
      stripe_event_at = coalesce(p_event_at, stripe_event_at)
    where id = p_user_id;
  end if;

  return coalesce(p_outcome, 'applied');
end $$;

revoke execute on function public.apply_stripe_event(text, text, uuid, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.apply_stripe_event(text, text, uuid, jsonb, text, timestamptz) to service_role;
