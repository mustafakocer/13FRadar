-- S4 · Stripe webhook idempotency and plan sync in one transaction.
--
-- stripe_events        one row per delivered Stripe event id. The webhook
--                      answers 200 and does nothing for an id already here.
-- apply_stripe_event   records the event and applies the profile change in
--                      the same transaction: either both land or neither.
--                      Returns 'duplicate' when the id was already recorded
--                      (a race between two deliveries), otherwise the outcome
--                      it was given ('applied', 'logged', 'skipped:…').
--                      Service role only.

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  user_id uuid,
  outcome text not null default 'applied',
  processed_at timestamptz not null default now()
);
comment on table public.stripe_events is 'Every Stripe webhook delivery, by event id. A second delivery of the same id is a no-op.';
create index if not exists stripe_events_processed_at on public.stripe_events (processed_at desc);

alter table public.stripe_events enable row level security;
-- no policies: only the service role (bypasses RLS) reads or writes it
revoke all on public.stripe_events from anon, authenticated;

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
      -- the account is gone; remember the event so Stripe is not retried
      -- for three days over a profile that no longer exists
      update public.stripe_events set outcome = 'skipped:no-profile' where id = p_event_id;
      return 'skipped:no-profile';
    end if;
  end if;

  return coalesce(p_outcome, 'applied');
end $$;

revoke execute on function public.apply_stripe_event(text, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_stripe_event(text, text, uuid, jsonb, text) to service_role;
