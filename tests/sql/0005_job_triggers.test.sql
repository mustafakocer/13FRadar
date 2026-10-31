-- 0005 acceptance: the cron jobs, the GitHub call, the log, the retry, and
-- nothing of it reachable through the API roles.
\set ON_ERROR_STOP on
\set QUIET on

-- 1. the five triggers and the collector are scheduled at the agreed times
do $$
declare got text;
begin
  select string_agg(jobname || ' ' || schedule, ', ' order by jobname collate "C") into got from cron.job where jobname like 'gh-%';
  if got <> 'gh-dispatch-collect */5 * * * *, gh-fpi 47 2 * * *, gh-freshness-am 23 7 * * *, gh-freshness-pm 17 13 * * *, gh-insiders-catchup 2 11 * * *, gh-universe 23 1 * * *' then
    raise exception 'FAIL: cron jobs are %', got;
  end if;
end $$;

-- 2. without the Vault secret nothing is sent; the log says why
do $$
declare n int; e text;
begin
  delete from ops.dispatch_log; delete from net.http_request_queue;
  perform ops.dispatch('fpi.yml');
  select count(*) into n from net.http_request_queue;
  if n <> 0 then raise exception 'FAIL: a request went out without a token'; end if;
  select error into e from ops.dispatch_log where workflow = 'fpi.yml';
  if e is distinct from 'no Vault secret github_actions_dispatch' then raise exception 'FAIL: log error is %', e; end if;
  -- no retry for a missing token
  perform ops.collect_dispatches();
  select count(*) into n from ops.dispatch_log;
  if n <> 1 then raise exception 'FAIL: retried a call that had no token (% rows)', n; end if;
end $$;

-- 3. with the token: one POST to the workflow_dispatch endpoint, on main, trigger=cron
insert into vault.decrypted_secrets values ('github_actions_dispatch', 'github_pat_test') on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
do $$
declare q record; req bigint;
begin
  delete from ops.dispatch_log; delete from net.http_request_queue;
  req := ops.dispatch('fpi.yml');
  select * into q from net.http_request_queue where id = req;
  if q.url <> 'https://api.github.com/repos/mustafakocer/13FRadar/actions/workflows/fpi.yml/dispatches' then raise exception 'FAIL: url %', q.url; end if;
  if q.body <> '{"ref": "main", "inputs": {"trigger": "cron"}}'::jsonb then raise exception 'FAIL: body %', q.body; end if;
  if q.headers ->> 'Authorization' <> 'Bearer github_pat_test' or q.headers ->> 'User-Agent' is null then raise exception 'FAIL: headers %', q.headers; end if;
  begin
    perform ops.dispatch('../secrets');
    raise exception 'FAIL: odd workflow name accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- 4. GitHub's 204 is recorded; a 401 is retried up to the third attempt, then left
do $$
declare ok_req bigint; bad_req bigint; n int; s int;
begin
  delete from ops.dispatch_log; delete from net.http_request_queue; delete from net._http_response;
  ok_req := ops.dispatch('fpi.yml');
  bad_req := ops.dispatch('insiders.yml');
  insert into net._http_response (id, status_code, content) values (ok_req, 204, ''), (bad_req, 401, '{"message":"Bad credentials"}');
  perform ops.collect_dispatches();
  select status into s from ops.dispatch_log where request_id = ok_req;
  if s <> 204 then raise exception 'FAIL: 204 not recorded (%)', s; end if;
  select count(*) into n from ops.dispatch_log where workflow = 'insiders.yml';
  if n <> 2 then raise exception 'FAIL: expected a retry of the 401, have % insider rows', n; end if;
  if (select error from ops.dispatch_log where request_id = bad_req) not like '%Bad credentials%' then raise exception 'FAIL: error text not kept'; end if;
  -- attempts 2 and 3 fail too; no fourth
  insert into net._http_response (id, status_code, content)
    select request_id, 401, 'no' from ops.dispatch_log where workflow = 'insiders.yml' and checked_at is null;
  perform ops.collect_dispatches();
  insert into net._http_response (id, status_code, content)
    select request_id, 401, 'no' from ops.dispatch_log where workflow = 'insiders.yml' and checked_at is null;
  perform ops.collect_dispatches();
  perform ops.collect_dispatches();
  select count(*) into n from ops.dispatch_log where workflow = 'insiders.yml';
  if n <> 3 then raise exception 'FAIL: % attempts, expected 3', n; end if;
  if (select max(attempt) from ops.dispatch_log) <> 3 then raise exception 'FAIL: attempt numbering'; end if;
  -- a successful call is not retried
  if (select count(*) from ops.dispatch_log where workflow = 'fpi.yml') <> 1 then raise exception 'FAIL: 204 retried'; end if;
end $$;

-- 5. a call nobody answered within 10 minutes counts as failed and is retried
do $$
declare n int;
begin
  delete from ops.dispatch_log; delete from net.http_request_queue;
  perform ops.dispatch('universe.yml');
  update ops.dispatch_log set requested_at = now() - interval '11 minutes';
  perform ops.collect_dispatches();
  select count(*) into n from ops.dispatch_log where workflow = 'universe.yml';
  if n <> 2 then raise exception 'FAIL: lost call not retried (% rows)', n; end if;
end $$;

-- 7. the token's expiry: read from GitHub's answer, kept, passed to freshness.yml only
do $$
declare req bigint; exp timestamptz; q record;
begin
  delete from ops.dispatch_log; delete from net.http_request_queue; delete from net._http_response;
  -- nothing known yet: freshness is dispatched without the input
  req := ops.dispatch('freshness.yml');
  select * into q from net.http_request_queue where id = req;
  if q.body <> '{"ref": "main", "inputs": {"trigger": "cron"}}'::jsonb then raise exception 'FAIL: body before any answer %', q.body; end if;
  -- GitHub's header (any case) on the answer; the collector keeps it
  insert into net._http_response (id, status_code, headers, content)
    values (req, 204, '{"X-GitHub-Request-Id": "abc", "GitHub-Authentication-Token-Expiration": "2026-10-29 11:02:00 UTC"}', '');
  perform ops.collect_dispatches();
  select token_expires_at into exp from ops.dispatch_log where request_id = req;
  if exp is distinct from '2026-10-29T11:02:00Z'::timestamptz then raise exception 'FAIL: token_expires_at is %', exp; end if;
  -- the next freshness dispatch carries it, ISO 8601 UTC; another workflow does not
  req := ops.dispatch('freshness.yml');
  select * into q from net.http_request_queue where id = req;
  if q.body <> '{"ref": "main", "inputs": {"trigger": "cron", "token_expires": "2026-10-29T11:02:00Z"}}'::jsonb then raise exception 'FAIL: freshness body %', q.body; end if;
  req := ops.dispatch('insiders.yml');
  select * into q from net.http_request_queue where id = req;
  if q.body <> '{"ref": "main", "inputs": {"trigger": "cron"}}'::jsonb then raise exception 'FAIL: insiders body %', q.body; end if;
  -- a rotated token: the newest answer wins
  insert into net._http_response (id, status_code, headers, content)
    values (req, 204, '{"github-authentication-token-expiration": "2027-10-01 00:00:00 UTC"}', '');
  perform ops.collect_dispatches();
  req := ops.dispatch('freshness.yml');
  select * into q from net.http_request_queue where id = req;
  if q.body -> 'inputs' ->> 'token_expires' <> '2027-10-01T00:00:00Z' then raise exception 'FAIL: rotated token not passed on: %', q.body; end if;
  -- no header, an unreadable value, a null: nothing recorded, nothing raised
  if ops.token_expiry('{"content-type": "application/json"}') is not null then raise exception 'FAIL: expiry without the header'; end if;
  if ops.token_expiry('{"github-authentication-token-expiration": "never"}') is not null then raise exception 'FAIL: unreadable expiry not null'; end if;
  if ops.token_expiry('{"github-authentication-token-expiration": ""}') is not null then raise exception 'FAIL: empty expiry not null'; end if;
  if ops.token_expiry(null) is not null then raise exception 'FAIL: null headers'; end if;
end $$;

-- 6. the API roles see nothing of ops
do $$
begin
  perform set_config('role', 'authenticated', true);
  begin
    perform count(*) from ops.dispatch_log;
    raise exception 'FAIL: authenticated reads ops.dispatch_log';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ops.dispatch('fpi.yml');
    raise exception 'FAIL: authenticated can call ops.dispatch';
  exception when insufficient_privilege then null;
  end;
  perform set_config('role', 'anon', true);
  begin
    perform ops.collect_dispatches();
    raise exception 'FAIL: anon can call ops.collect_dispatches';
  exception when insufficient_privilege then null;
  end;
  begin
    perform ops.token_expiry('{}');
    raise exception 'FAIL: anon can call ops.token_expiry';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

delete from vault.decrypted_secrets where name = 'github_actions_dispatch';
\echo '0005_job_triggers: ok'
