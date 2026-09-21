-- S4 acceptance: the same event applied twice changes the profile once.
\set ON_ERROR_STOP on
\set QUIET on

do $$
declare r text; before record; after record;
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  r := public.apply_stripe_event('evt_1', 'checkout.session.completed', '00000000-0000-4000-8000-00000000000b',
        '{"plan":"pro","plan_expires":"2030-01-01T00:00:00Z","stripe_customer_id":"cus_b","stripe_subscription_id":"sub_b"}'::jsonb, 'applied');
  if r <> 'applied' then raise exception 'FAIL: first apply returned %', r; end if;
  select plan, plan_expires, stripe_customer_id, stripe_subscription_id into before from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
  if before.plan <> 'pro' or before.stripe_subscription_id <> 'sub_b' then raise exception 'FAIL: patch not applied: %', before; end if;

  -- same event id again, even with a different (hostile) patch: nothing moves
  r := public.apply_stripe_event('evt_1', 'checkout.session.completed', '00000000-0000-4000-8000-00000000000b',
        '{"plan":"free","plan_expires":null}'::jsonb, 'applied');
  if r <> 'duplicate' then raise exception 'FAIL: second apply returned %', r; end if;
  select plan, plan_expires, stripe_customer_id, stripe_subscription_id into after from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
  if after is distinct from before then raise exception 'FAIL: duplicate changed the row: % -> %', before, after; end if;
  if (select count(*) from public.stripe_events) <> 1 then raise exception 'FAIL: event recorded twice'; end if;

  -- a later event moves it on
  r := public.apply_stripe_event('evt_2', 'customer.subscription.deleted', '00000000-0000-4000-8000-00000000000b',
        '{"plan":"free","plan_expires":null,"stripe_subscription_id":null}'::jsonb, 'applied');
  if r <> 'applied' then raise exception 'FAIL: evt_2 returned %', r; end if;
  if public.is_pro('00000000-0000-4000-8000-00000000000b') then raise exception 'FAIL: still pro after deleted'; end if;
  if (select stripe_customer_id from public.profiles where id = '00000000-0000-4000-8000-00000000000b') <> 'cus_b' then
    raise exception 'FAIL: customer id should survive a subscription delete';
  end if;

  -- a log-only event is recorded and touches nothing
  r := public.apply_stripe_event('evt_3', 'invoice.payment_failed', '00000000-0000-4000-8000-00000000000b', '{}'::jsonb, 'logged');
  if r <> 'logged' then raise exception 'FAIL: evt_3 returned %', r; end if;

  -- an event for an account that no longer exists is remembered, not retried
  r := public.apply_stripe_event('evt_4', 'customer.subscription.updated', gen_random_uuid(), '{"plan":"pro"}'::jsonb, 'applied');
  if r <> 'skipped:no-profile' then raise exception 'FAIL: evt_4 returned %', r; end if;
  if (select outcome from public.stripe_events where id = 'evt_4') <> 'skipped:no-profile' then raise exception 'FAIL: outcome not recorded'; end if;

  raise notice 'ok 10. apply_stripe_event: applied once, duplicate is a no-op, delete keeps customer id, missing profile recorded';
end $$;

-- user tokens can neither call it nor read the log
do $$ begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  begin
    perform public.apply_stripe_event('evt_x', 'checkout.session.completed', auth.uid(), '{"plan":"pro"}'::jsonb, 'applied');
    raise exception 'FAIL: user called apply_stripe_event';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.stripe_events;
    raise exception 'FAIL: user read stripe_events';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok 11. apply_stripe_event / stripe_events: service role only';
end $$;
