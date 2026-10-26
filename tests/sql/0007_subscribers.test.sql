-- S8 acceptance: lead-magnet subscribers are invisible to every API role
-- except the service role, and the table refuses malformed rows.
\set ON_ERROR_STOP on
\set QUIET on

-- 30. the service role writes; constraints hold
do $$
begin
  perform set_config('role', 'service_role', true);
  insert into public.subscribers (email, unsub_token, magnets, gurus)
    values ('reader@example.com', 'unsub-token-0000000000000001', '["newsletter"]', '["0001067983"]');
  begin
    insert into public.subscribers (email, unsub_token) values ('Reader@Example.com ', 'unsub-token-0000000000000002');
    raise exception 'FAIL: un-normalised email accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.subscribers (email, unsub_token) values ('reader@example.com', 'unsub-token-0000000000000003');
    raise exception 'FAIL: duplicate email accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.subscribers (email, unsub_token, status) values ('other@example.com', 'unsub-token-0000000000000004', 'maybe');
    raise exception 'FAIL: unknown status accepted';
  exception when check_violation then null;
  end;
  update public.subscribers set status = 'confirmed' where email = 'reader@example.com';
  if (select updated_at from public.subscribers where email = 'reader@example.com') < now() - interval '5 seconds' then
    raise exception 'FAIL: updated_at not touched';
  end if;
  perform set_config('role', 'postgres', true);
end $$;

-- 31. anon and authenticated see nothing and write nothing
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  begin
    select count(*) into n from public.subscribers;
    raise exception 'FAIL: authenticated can read subscribers (% rows)', n;
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'anon', true);
  begin
    insert into public.subscribers (email, unsub_token) values ('evil@example.com', 'unsub-token-0000000000000005');
    raise exception 'FAIL: anon can insert subscribers';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'postgres', true);
end $$;

\echo 'ok 0007_subscribers'
