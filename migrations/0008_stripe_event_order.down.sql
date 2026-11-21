-- Reverts 0008_stripe_event_order.up.sql: apply_stripe_event back to its
-- five-argument form (0003), the guard back to its 0001 column list, the
-- column dropped. Plans and the delivery log stay as they are.
drop function if exists public.apply_stripe_event(text, text, uuid, jsonb, text, timestamptz);

create or replace function public.apply_stripe_event(
  p_event_id text,
  p_event_type text,
  p_user_id uuid default null,
  p_patch jsonb default '{}'::jsonb,
  p_outcome text default 'applied'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  touched int;
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
    update public.profiles set
      plan = case when p_patch ? 'plan' then p_patch ->> 'plan' else plan end,
      plan_expires = case when p_patch ? 'plan_expires' then (p_patch ->> 'plan_expires')::timestamptz else plan_expires end,
      stripe_customer_id = case when p_patch ? 'stripe_customer_id' then p_patch ->> 'stripe_customer_id' else stripe_customer_id end,
      stripe_subscription_id = case when p_patch ? 'stripe_subscription_id' then p_patch ->> 'stripe_subscription_id' else stripe_subscription_id end
    where id = p_user_id;
    get diagnostics touched = row_count;
    if touched = 0 then
      update public.stripe_events set outcome = 'skipped:no-profile' where id = p_event_id;
      return 'skipped:no-profile';
    end if;
  end if;

  return coalesce(p_outcome, 'applied');
end $$;

revoke execute on function public.apply_stripe_event(text, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_stripe_event(text, text, uuid, jsonb, text) to service_role;

create or replace function public.profiles_guard_columns()
returns trigger language plpgsql as $$
declare
  jwt_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role');
begin
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

alter table public.profiles drop column if exists stripe_event_at;
