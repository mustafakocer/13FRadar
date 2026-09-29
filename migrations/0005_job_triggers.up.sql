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
comment on table ops.dispatch_log is 'One row per call to GitHub workflow_dispatch from pg_cron. status 204 = GitHub accepted it. 401/403: the Vault token github_actions_dispatch expired or lacks Actions write. 422: the workflow does not accept inputs.trigger.';

create or replace function ops.dispatch(workflow text, attempt int default 1)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  tok text;
  req bigint;
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
  req := net.http_post(
    url := 'https://api.github.com/repos/mustafakocer/13FRadar/actions/workflows/' || workflow || '/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('trigger', 'cron')),
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
