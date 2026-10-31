-- Start the data jobs on the minute. GitHub's scheduler started every nightly
-- job 5–7 hours late (fpi 02:47 → 09:05, insiders 03:31 → 10:00, once
-- 18:33). pg_cron fires on time and pg_net calls GitHub's workflow_dispatch
-- API with inputs.trigger = 'cron'; the workflows' own `schedule:` stays as
-- a fallback, and a run that finds its window already done skips itself
-- (api/_lib/jobTriggers.js). The times match TRIGGERS there (a test reads
-- this file).
--
-- ops.dispatch(workflow)       one POST to GitHub, logged in ops.dispatch_log
-- ops.collect_dispatches()     every 5 minutes: copies GitHub's answer from
--                              net._http_response (kept only 6 hours) into
--                              the log, retries a failed call up to 3 times
--                              within the hour, trims old history
-- token                        Vault secret 'github_actions_dispatch': a
--                              fine-grained token, this repository only,
--                              Actions read & write. Never in this file.
--                              GitHub answers every call with the header
--                              github-authentication-token-expiration; the
--                              collector keeps it (dispatch_log.token_expires_at)
--                              and each freshness.yml dispatch passes it on as
--                              inputs.token_expires, so check-triggers.mjs
--                              can warn two weeks before the token dies. The
--                              first token (30 days) expired unnoticed on
--                              2026-10-29 and every job ran 5–6 hours late
--                              on the GitHub fallback until somebody looked.
--                              Rotation: migrations/README.md.
--
-- ops is not exposed through the API: no grants to anon / authenticated.
-- Applying this file sends one test call (freshness.yml, a 10-minute check).

-- ------------------------------------------------------------- extensions ---
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  elsif to_regnamespace('cron') is null then
    raise exception 'pg_cron is not available on this database';
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  elsif to_regnamespace('net') is null then
    raise exception 'pg_net is not available on this database';
  end if;
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault (vault.decrypted_secrets) is not available on this database';
  end if;
end $$;

-- -------------------------------------------------------------------- ops ---
create schema if not exists ops;
revoke all on schema ops from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema ops from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema ops from authenticated'; end if;
end $$;

create table if not exists ops.dispatch_log (
  id bigserial primary key,
  workflow text not null,
  attempt int not null default 1,
  requested_at timestamptz not null default now(),
  request_id bigint,
  status int,
  error text,
  checked_at timestamptz,
  retried boolean not null default false
);
create index if not exists dispatch_log_open on ops.dispatch_log (requested_at) where checked_at is null or (not retried);
alter table ops.dispatch_log add column if not exists token_expires_at timestamptz;
comment on table ops.dispatch_log is 'One row per call to GitHub workflow_dispatch from pg_cron. status 204 = GitHub accepted it. 401/403: the Vault token github_actions_dispatch expired or lacks Actions write. 422: the workflow does not accept inputs.trigger (or inputs.token_expires, freshness.yml). token_expires_at: when the token used for that call expires, from GitHub''s response header.';

-- When does the token GitHub just answered with expire? From the response
-- header github-authentication-token-expiration ("2026-10-29 11:02:00 UTC").
-- Null when the header is missing (a token without expiry, or no answer) or
-- unreadable.
create or replace function ops.token_expiry(headers jsonb)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  v text;
begin
  if headers is null then
    return null;
  end if;
  select value into v from jsonb_each_text(headers) where lower(key) = 'github-authentication-token-expiration' limit 1;
  if v is null or v = '' then
    return null;
  end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

create or replace function ops.dispatch(workflow text, attempt int default 1)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  tok text;
  req bigint;
  inputs jsonb := jsonb_build_object('trigger', 'cron');
  expires text;
begin
  if workflow !~ '^[a-z0-9-]+\.yml$' then
    raise exception 'bad workflow name %', workflow;
  end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'github_actions_dispatch' limit 1;
  if tok is null or tok = '' then
    insert into ops.dispatch_log (workflow, attempt, error, checked_at, retried)
      values (workflow, attempt, 'no Vault secret github_actions_dispatch', now(), true);
    return null;
  end if;
  -- the freshness check hears when the token expires (last answer GitHub
  -- gave); only freshness.yml declares the input, another workflow would
  -- answer 422
  if workflow = 'freshness.yml' then
    select to_char(token_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') into expires
      from ops.dispatch_log where token_expires_at is not null order by id desc limit 1;
    if expires is not null then
      inputs := inputs || jsonb_build_object('token_expires', expires);
    end if;
  end if;
  req := net.http_post(
    url := 'https://api.github.com/repos/mustafakocer/13FRadar/actions/workflows/' || workflow || '/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', inputs),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'fundocap-cron',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
  insert into ops.dispatch_log (workflow, attempt, request_id) values (workflow, attempt, req);
  return req;
end $$;

create or replace function ops.collect_dispatches()
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  -- GitHub's answer, before pg_net forgets it
  update ops.dispatch_log l
     set status = h.status_code,
         error = case when h.status_code between 200 and 299 then null
                      else coalesce(h.error_msg, case when h.timed_out then 'timed out' end, left(h.content, 300)) end,
         token_expires_at = ops.token_expiry(h.headers),
         checked_at = now()
    from net._http_response h
   where h.id = l.request_id and l.checked_at is null;
  -- no answer after 10 minutes: lost
  update ops.dispatch_log
     set error = 'no response recorded', checked_at = now()
   where checked_at is null and requested_at < now() - interval '10 minutes';
  -- retry a failed call, three attempts within the hour
  for r in
    select id, workflow, attempt from ops.dispatch_log
     where checked_at is not null and not retried
       and (status is null or status not between 200 and 299)
       and error is distinct from 'no Vault secret github_actions_dispatch'
       and attempt < 3 and requested_at > now() - interval '1 hour'
  loop
    update ops.dispatch_log set retried = true where id = r.id;
    perform ops.dispatch(r.workflow, r.attempt + 1);
  end loop;
  update ops.dispatch_log set retried = true where not retried and checked_at is not null;
  delete from ops.dispatch_log where requested_at < now() - interval '180 days';
  delete from cron.job_run_details where end_time < now() - interval '30 days';
end $$;

revoke all on all tables in schema ops from public;
revoke all on all functions in schema ops from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema ops from anon';
    execute 'revoke all on all functions in schema ops from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema ops from authenticated';
    execute 'revoke all on all functions in schema ops from authenticated';
  end if;
end $$;

-- ------------------------------------------------------------- schedules ---
-- UTC. Odd minutes, same as the workflows. Re-scheduling a name replaces it.
select cron.schedule('gh-universe', '23 1 * * *', $$select ops.dispatch('universe.yml')$$);
select cron.schedule('gh-fpi', '47 2 * * *', $$select ops.dispatch('fpi.yml')$$);
select cron.schedule('gh-freshness-am', '23 7 * * *', $$select ops.dispatch('freshness.yml')$$);
select cron.schedule('gh-insiders-catchup', '2 11 * * *', $$select ops.dispatch('insiders.yml')$$);
select cron.schedule('gh-freshness-pm', '17 13 * * *', $$select ops.dispatch('freshness.yml')$$);
select cron.schedule('gh-dispatch-collect', '*/5 * * * *', $$select ops.collect_dispatches()$$);

-- the test call: a Data freshness run appears in GitHub Actions within a
-- minute when the token works (or a row with an error in ops.dispatch_log)
select ops.dispatch('freshness.yml');
