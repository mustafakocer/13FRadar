-- S6 acceptance. Users A (pro, from 0001) and B (free) exist; the signup
-- trigger — already in its 0004 form when they were inserted — made their
-- preference rows.
\set ON_ERROR_STOP on
\set QUIET on

-- 12. signup made an opt-in (false) preference row; a user reads and writes only its own
do $$
declare n int; f text;
begin
  if (select email_digest from public.notification_prefs where user_id = '00000000-0000-4000-8000-00000000000a') is distinct from false then
    raise exception 'FAIL: signup must create notification_prefs with email_digest = false';
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  select count(*) into n from public.notification_prefs;
  if n <> 1 then raise exception 'FAIL: user A sees % preference rows', n; end if;
  -- the client upserts its own row
  insert into public.notification_prefs (user_id, email_digest, digest_frequency)
    values (auth.uid(), true, 'daily')
    on conflict (user_id) do update set email_digest = excluded.email_digest, digest_frequency = excluded.digest_frequency;
  select digest_frequency into f from public.notification_prefs where user_id = auth.uid();
  if f <> 'daily' or not (select email_digest from public.notification_prefs where user_id = auth.uid()) then
    raise exception 'FAIL: own preference row not updated';
  end if;
  if (select updated_at from public.notification_prefs where user_id = auth.uid()) < now() - interval '5 seconds' then
    raise exception 'FAIL: updated_at not touched';
  end if;
  begin
    update public.notification_prefs set digest_frequency = 'hourly' where user_id = auth.uid();
    raise exception 'FAIL: bad frequency accepted';
  exception when check_violation then null;
  end;
  -- another user's row: invisible, unwritable
  update public.notification_prefs set email_digest = true where user_id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A updated prefs of B'; end if;
  begin
    insert into public.notification_prefs (user_id, email_digest) values ('00000000-0000-4000-8000-00000000000b', true)
      on conflict (user_id) do update set email_digest = true;
    raise exception 'FAIL: user A upserted prefs of B';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok 12. notification_prefs: opt-in default, own upsert works, frequency CHECK, other user 0 rows';
end $$;

-- 13. alerts: own CRUD, target normalisation, kind/target CHECK, other user 0 rows, anon nothing
do $$
declare n int; tgt text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  insert into public.alerts (user_id, kind, target, label) values (auth.uid(), 'filing', '1067983', 'Berkshire');
  select target into tgt from public.alerts where user_id = auth.uid() and kind = 'filing';
  if tgt <> '0001067983' then raise exception 'FAIL: CIK not padded: %', tgt; end if;
  insert into public.alerts (user_id, kind, target, filters) values (auth.uid(), 'insider', 'aapl', '{"roles":["ceo"]}'::jsonb);
  if (select target from public.alerts where user_id = auth.uid() and kind = 'insider') <> 'AAPL' then raise exception 'FAIL: ticker not upper-cased'; end if;
  -- turning the same alert on twice is one row
  insert into public.alerts (user_id, kind, target, label) values (auth.uid(), 'filing', '0001067983', 'Berkshire Hathaway')
    on conflict (user_id, kind, target) do update set label = excluded.label;
  select count(*) into n from public.alerts where user_id = auth.uid();
  if n <> 2 then raise exception 'FAIL: expected 2 alerts, got %', n; end if;
  begin
    insert into public.alerts (user_id, kind, target) values (auth.uid(), 'price', 'AAPL');
    raise exception 'FAIL: unknown kind accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.alerts (user_id, kind, target) values (auth.uid(), 'filing', 'AAPL');
    raise exception 'FAIL: a ticker accepted as a filing target';
  exception when check_violation then null;
  end;
  insert into public.alerts (user_id, kind, target) values (auth.uid(), 'insider', '*');
  delete from public.alerts where user_id = auth.uid() and target = '*';
  -- user A cannot see or touch B's alerts
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  select count(*) into n from public.alerts;
  if n <> 0 then raise exception 'FAIL: user A sees % of B''s alerts', n; end if;
  delete from public.alerts where user_id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A deleted B''s alerts'; end if;
  begin
    insert into public.alerts (user_id, kind, target) values ('00000000-0000-4000-8000-00000000000b', 'filing', '0001350694');
    raise exception 'FAIL: user A inserted an alert for B';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform * from public.alerts;
    raise exception 'FAIL: anon can select alerts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.notification_prefs;
    raise exception 'FAIL: anon can select notification_prefs';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok 13. alerts: own CRUD, CIK padded / ticker upper-cased, kind+target CHECK, unique per target, other user 0 rows, anon denied';
end $$;

-- 14. cap: free 5 / pro 100; a bulk insert is judged on its total
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  -- B (free) has 2; fill to 5
  insert into public.alerts (user_id, kind, target)
    select auth.uid(), 'filing', lpad(g::text, 10, '0') from generate_series(1, 3) g;
  begin
    insert into public.alerts (user_id, kind, target) values (auth.uid(), 'filing', '0000000099');
    raise exception 'FAIL: 6th alert accepted on free';
  exception when raise_exception then
    if position('alert limit' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    insert into public.alerts (user_id, kind, target)
      select auth.uid(), 'filing', lpad((100 + g)::text, 10, '0') from generate_series(1, 20) g;
    raise exception 'FAIL: bulk insert past the cap accepted';
  exception when raise_exception then
    if position('alert limit' in sqlerrm) = 0 then raise; end if;
  end;
  select count(*) into n from public.alerts where user_id = auth.uid();
  if n <> 5 then raise exception 'FAIL: cap left % rows', n; end if;
  -- A (pro): 100 ok, 101 not
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  insert into public.alerts (user_id, kind, target)
    select auth.uid(), 'filing', lpad(g::text, 10, '0') from generate_series(1, 100) g;
  begin
    insert into public.alerts (user_id, kind, target) values (auth.uid(), 'filing', '0000000101');
    raise exception 'FAIL: 101st alert accepted on pro';
  exception when raise_exception then
    if position('alert limit' in sqlerrm) = 0 then raise; end if;
  end;
  raise notice 'ok 14. alert cap: free 5 / pro 100, bulk insert judged as a whole';
end $$;

-- 15. the service role reads everyone's rows (the digest) and the cascade cleans up
do $$
declare n int;
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select count(*) into n from public.alerts;
  if n <> 105 then raise exception 'FAIL: service role sees % alerts', n; end if;
  select count(*) into n from public.notification_prefs where email_digest;
  if n <> 1 then raise exception 'FAIL: % opted-in readers, expected 1 (A)', n; end if;
  update public.alerts set last_seen = '2026-08-14', last_fired_at = now() where user_id = '00000000-0000-4000-8000-00000000000b' and kind = 'filing' and target = '0001067983';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: digest mark not written'; end if;
  raise notice 'ok 15. service role: reads all alerts, writes the digest mark';
end $$;
