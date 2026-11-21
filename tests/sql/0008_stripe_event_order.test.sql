-- S9 acceptance: an older Stripe event cannot overwrite a newer one, the
-- five-argument call still works, and a user cannot move the marker.
\set ON_ERROR_STOP on
\set QUIET on

do $$
declare r text; p record;
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- a clean slate for the profile the 0003 test also uses
  update public.profiles set plan = 'free', plan_expires = null, stripe_subscription_id = null, stripe_event_at = null
   where id = '00000000-0000-4000-8000-00000000000b';

  -- subscription.updated(active) at 10:00, deleted at 10:05, delivered in order
  r := public.apply_stripe_event('evt_o1', 'customer.subscription.updated', '00000000-0000-4000-8000-00000000000b',
        '{"plan":"pro","plan_expires":"2030-01-01T00:00:00Z"}'::jsonb, 'applied', '2029-06-01T10:00:00Z');
  if r <> 'applied' then raise exception 'FAIL: evt_o1 returned %', r; end if;
  r := public.apply_stripe_event('evt_o2', 'customer.subscription.deleted', '00000000-0000-4000-8000-00000000000b',
        '{"plan":"free","plan_expires":null}'::jsonb, 'applied', '2029-06-01T10:05:00Z');
  if r <> 'applied' then raise exception 'FAIL: evt_o2 returned %', r; end if;

  -- a second updated(active) from 10:02 arrives last: recorded, changes nothing
  r := public.apply_stripe_event('evt_o3', 'customer.subscription.updated', '00000000-0000-4000-8000-00000000000b',
        '{"plan":"pro","plan_expires":"2030-01-01T00:00:00Z"}'::jsonb, 'applied', '2029-06-01T10:02:00Z');
  if r <> 'ignored:stale' then raise exception 'FAIL: late event returned %', r; end if;
  select plan, plan_expires, stripe_event_at into p from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
  if p.plan <> 'free' or p.plan_expires is not null then raise exception 'FAIL: a stale event changed the plan: %', p; end if;
  if p.stripe_event_at <> '2029-06-01T10:05:00Z'::timestamptz then raise exception 'FAIL: marker moved back: %', p; end if;
  if (select outcome from public.stripe_events where id = 'evt_o3') <> 'ignored:stale' then raise exception 'FAIL: stale outcome not recorded'; end if;

  -- its redelivery is still a duplicate
  r := public.apply_stripe_event('evt_o3', 'customer.subscription.updated', '00000000-0000-4000-8000-00000000000b',
        '{"plan":"pro"}'::jsonb, 'applied', '2029-06-01T10:02:00Z');
  if r <> 'duplicate' then raise exception 'FAIL: redelivered stale event returned %', r; end if;

  -- the same second is applied (a checkout and its subscription.created)
  r := public.apply_stripe_event('evt_o4', 'customer.subscription.created', '00000000-0000-4000-8000-00000000000b',
        '{"plan":"pro","plan_expires":"2030-02-01T00:00:00Z"}'::jsonb, 'applied', '2029-06-01T10:05:00Z');
  if r <> 'applied' then raise exception 'FAIL: same-second event returned %', r; end if;

  -- a log-only event (empty patch) is never stale and does not move the marker
  r := public.apply_stripe_event('evt_o5', 'invoice.payment_failed', '00000000-0000-4000-8000-00000000000b',
        '{}'::jsonb, 'logged', '2029-01-01T00:00:00Z');
  if r <> 'logged' then raise exception 'FAIL: log-only event returned %', r; end if;
  if (select stripe_event_at from public.profiles where id = '00000000-0000-4000-8000-00000000000b') <> '2029-06-01T10:05:00Z'::timestamptz then
    raise exception 'FAIL: a log-only event moved the marker';
  end if;

  -- the call a deployment older than this migration makes: no time, applied
  -- as before, marker kept
  r := public.apply_stripe_event('evt_o6', 'customer.subscription.deleted', '00000000-0000-4000-8000-00000000000b',
        '{"plan":"free","plan_expires":null}'::jsonb, 'applied');
  if r <> 'applied' then raise exception 'FAIL: five-argument call returned %', r; end if;
  select plan, stripe_event_at into p from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
  if p.plan <> 'free' or p.stripe_event_at <> '2029-06-01T10:05:00Z'::timestamptz then raise exception 'FAIL: five-argument call: %', p; end if;

  -- one function only, or PostgREST cannot pick a candidate
  if (select count(*) from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
       where n.nspname = 'public' and pr.proname = 'apply_stripe_event') <> 1 then
    raise exception 'FAIL: apply_stripe_event is overloaded';
  end if;

  raise notice 'ok 30. apply_stripe_event: older event ignored:stale, same second applied, log-only and untimed calls unchanged';
end $$;

-- the marker is a server-only column
do $$ begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  begin
    update public.profiles set stripe_event_at = null where id = '00000000-0000-4000-8000-00000000000b';
    raise exception 'FAIL: user rewrote stripe_event_at';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.apply_stripe_event('evt_oy', 'checkout.session.completed', auth.uid(), '{"plan":"pro"}'::jsonb, 'applied', now());
    raise exception 'FAIL: user called apply_stripe_event';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok 31. stripe_event_at / apply_stripe_event: service role only';
end $$;
