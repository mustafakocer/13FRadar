-- Which migrations are actually on this database?
--
-- Run in the Supabase SQL editor (read-only, changes nothing). Each row is
-- one object a migration creates; the query lists only the ones that are
-- MISSING, or a single "all present" row. A migration with missing rows was
-- not applied (or only in part): apply its .up.sql, then run this again.
--
-- Why it exists: 0006_digest_marks was never applied in production while
-- 0007 was, and nothing showed it until the account page broke (2026-10-29).
-- Add the new objects here whenever a migration is added.

with expected(migration, kind, schema_name, tbl, name) as (values
  -- 0000 baseline
  ('0000_baseline', 'table',    'public', null, 'profiles'),
  ('0000_baseline', 'table',    'public', null, 'watchlists'),
  ('0000_baseline', 'column',   'public', 'profiles', 'stripe_customer_id'),
  ('0000_baseline', 'column',   'public', 'profiles', 'stripe_subscription_id'),
  -- 0001 rls
  ('0001_rls', 'function', 'public', null, 'is_pro'),
  ('0001_rls', 'function', 'public', null, 'profiles_guard_columns'),
  ('0001_rls', 'function', 'public', null, 'handle_user_email_change'),
  ('0001_rls', 'function', 'public', null, 'watchlists_enforce_cap'),
  ('0001_rls', 'function', 'public', null, 'watchlists_cap'),
  ('0001_rls', 'function', 'public', null, 'watchlists_cap_pro'),
  ('0001_rls', 'policy',   'public', 'profiles', 'profiles_select_own'),
  ('0001_rls', 'policy',   'public', 'profiles', 'profiles_update_own'),
  ('0001_rls', 'policy',   'public', 'watchlists', 'watchlists_select_own'),
  ('0001_rls', 'policy',   'public', 'watchlists', 'watchlists_insert_own'),
  ('0001_rls', 'policy',   'public', 'watchlists', 'watchlists_update_own'),
  ('0001_rls', 'policy',   'public', 'watchlists', 'watchlists_delete_own'),
  ('0001_rls', 'trigger',  'auth',   'users', 'on_auth_user_created'),
  ('0001_rls', 'trigger',  'auth',   'users', 'on_auth_user_email_changed'),
  ('0001_rls', 'trigger',  'public', 'profiles', 'profiles_guard_columns'),
  ('0001_rls', 'trigger',  'public', 'watchlists', 'watchlists_10_cap'),
  -- 0002 constraints
  ('0002_constraints', 'constraint', 'public', 'profiles', 'profiles_plan_check'),
  ('0002_constraints', 'constraint', 'public', 'watchlists', 'watchlists_cik_check'),
  ('0002_constraints', 'function',   'public', null, 'watchlists_normalize_cik'),
  ('0002_constraints', 'trigger',    'public', 'watchlists', 'watchlists_00_normalize_cik'),
  ('0002_constraints', 'index',      'public', null, 'profiles_stripe_customer_id_key'),
  ('0002_constraints', 'index',      'public', null, 'profiles_stripe_subscription_id_key'),
  -- 0003 stripe events
  ('0003_stripe_events', 'table',    'public', null, 'stripe_events'),
  ('0003_stripe_events', 'function', 'public', null, 'apply_stripe_event'),
  -- 0004 alerts
  ('0004_alerts', 'table',      'public', null, 'alerts'),
  ('0004_alerts', 'table',      'public', null, 'notification_prefs'),
  ('0004_alerts', 'column',     'public', 'notification_prefs', 'digest_frequency'),
  ('0004_alerts', 'column',     'public', 'alerts', 'last_seen'),
  ('0004_alerts', 'function',   'public', null, 'alerts_enforce_cap'),
  ('0004_alerts', 'function',   'public', null, 'alerts_normalize_target'),
  ('0004_alerts', 'function',   'public', null, 'touch_updated_at'),
  ('0004_alerts', 'policy',     'public', 'alerts', 'alerts_select_own'),
  ('0004_alerts', 'policy',     'public', 'notification_prefs', 'notification_prefs_select_own'),
  ('0004_alerts', 'trigger',    'public', 'alerts', 'alerts_05_cap'),
  ('0004_alerts', 'trigger',    'public', 'notification_prefs', 'notification_prefs_touch'),
  ('0004_alerts', 'constraint', 'public', 'notification_prefs', 'notification_prefs_frequency_check'),
  ('0004_alerts', 'index',      'public', null, 'alerts_user_kind_target_key'),
  -- 0005 job triggers (pg_cron + pg_net dispatch of the data workflows)
  -- pg_cron and pg_net, by the schemas they provide (as 0005 itself checks)
  ('0005_job_triggers', 'schema',    null, null, 'cron'),
  ('0005_job_triggers', 'schema',    null, null, 'net'),
  ('0005_job_triggers', 'schema',    null, null, 'ops'),
  ('0005_job_triggers', 'table',     'ops', null, 'dispatch_log'),
  ('0005_job_triggers', 'function',  'ops', null, 'dispatch'),
  ('0005_job_triggers', 'function',  'ops', null, 'collect_dispatches'),
  -- 0006 digest marks
  ('0006_digest_marks', 'column',     'public', 'notification_prefs', 'lang'),
  ('0006_digest_marks', 'column',     'public', 'notification_prefs', 'filings_seen'),
  ('0006_digest_marks', 'column',     'public', 'notification_prefs', 'filings_seen_acc'),
  ('0006_digest_marks', 'column',     'public', 'notification_prefs', 'form4_seen'),
  ('0006_digest_marks', 'column',     'public', 'notification_prefs', 'last_sent_at'),
  ('0006_digest_marks', 'constraint', 'public', 'notification_prefs', 'notification_prefs_lang_check'),
  -- the 0006 signup trigger seeds the marks; an older body does not
  ('0006_digest_marks', 'function_body', 'public', 'filings_seen', 'handle_new_user'),
  -- 0007 subscribers
  ('0007_subscribers', 'table',      'public', null, 'subscribers'),
  ('0007_subscribers', 'column',     'public', 'subscribers', 'unsub_token'),
  ('0007_subscribers', 'column',     'public', 'subscribers', 'newsletter_sent_at'),
  ('0007_subscribers', 'constraint', 'public', 'subscribers', 'subscribers_status_check'),
  ('0007_subscribers', 'index',      'public', null, 'subscribers_email_key'),
  ('0007_subscribers', 'trigger',    'public', 'subscribers', 'subscribers_touch')
),
checked as (
  select e.*,
    case e.kind
      when 'table' then to_regclass(format('%I.%I', e.schema_name, e.name)) is not null
      when 'index' then to_regclass(format('%I.%I', e.schema_name, e.name)) is not null
      when 'column' then exists (
        select 1 from information_schema.columns c
         where c.table_schema = e.schema_name and c.table_name = e.tbl and c.column_name = e.name)
      when 'function' then exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = e.schema_name and p.proname = e.name)
      when 'function_body' then exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = e.schema_name and p.proname = e.name and p.prosrc like '%' || e.tbl || '%')
      when 'policy' then exists (
        select 1 from pg_policies x
         where x.schemaname = e.schema_name and x.tablename = e.tbl and x.policyname = e.name)
      when 'trigger' then exists (
        select 1 from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = e.schema_name and c.relname = e.tbl and t.tgname = e.name and not t.tgisinternal)
      when 'constraint' then exists (
        select 1 from pg_constraint k
          join pg_class c on c.oid = k.conrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = e.schema_name and c.relname = e.tbl and k.conname = e.name)
      when 'schema' then exists (select 1 from pg_namespace where nspname = e.name)
    end as present
  from expected e
)
select migration, kind,
       concat_ws('.', schema_name, case when kind = 'function_body' then null else tbl end, name) as object,
       case when kind = 'function_body' then 'body does not mention ' || tbl end as note
  from checked
 where not present
union all
select 'all present', null, null, null
 where not exists (select 1 from checked where not present)
order by 1, 2, 3;

-- 0005 also schedules the dispatch jobs; with pg_cron installed this lists
-- them (expect gh-universe, gh-fpi, gh-freshness-am, gh-insiders-catchup,
-- gh-freshness-pm, gh-dispatch-collect):
--   select jobname, schedule, active from cron.job order by jobname;
