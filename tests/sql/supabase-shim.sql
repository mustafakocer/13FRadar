-- Enough of a Supabase project to run migrations/ and tests/sql/ on a plain
-- Postgres: the three API roles, the auth schema with auth.users and the
-- auth.uid()/auth.role()/auth.jwt() helpers, and the default grants Supabase
-- gives the API roles on public. PostgREST is emulated in the tests by
-- set_config('role', …) plus set_config('request.jwt.claims', …), which is
-- exactly what it does per request.
--
-- Never run this against a real Supabase project: the objects already exist.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- pg_cron, pg_net and Vault stand-ins for migrations/0005_job_triggers:
-- cron.schedule() records the job, net.http_post() records the request and
-- answers nothing (tests write net._http_response rows themselves), and
-- vault.decrypted_secrets is a plain table.
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create table if not exists cron.job_run_details (runid bigserial primary key, jobid bigint, end_time timestamptz);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;
create or replace function cron.unschedule(job_name text) returns boolean
language sql as $$ delete from cron.job where jobname = job_name returning true $$;

create schema if not exists net;
create table if not exists net.http_request_queue (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds int);
create table if not exists net._http_response (id bigint primary key, status_code int, content text, timed_out boolean, error_msg text, created timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint
language sql as $$
  insert into net.http_request_queue (url, body, headers, timeout_milliseconds) values (url, body, headers, timeout_milliseconds) returning id
$$;

create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text primary key, decrypted_secret text);
