# migrations/

Migrations for the **live** Supabase project (`public.profiles`,
`public.watchlists`, `public.stripe_events`, `public.notification_prefs`,
`public.alerts`). Each one is an `up`/`down` pair,
plain SQL, safe to re-run. The opt-in historical store has its own single file
(`supabase/history-schema.sql`) and is not applied anywhere yet.

| File | What |
|---|---|
| `0000_baseline` | The schema as it already exists in production (2026-09-21). No-op on the live project; needed for an empty database. |
| `0001_rls` | S2 · policies, `is_pro()`, server-only billing columns, watchlist cap |
| `0002_constraints` | S3 · `plan` CHECK, `ls_customer_id` dropped, Stripe id UNIQUE, CIK normalisation |
| `0003_stripe_events` | S4 · webhook idempotency table + `apply_stripe_event()` |
| `0004_alerts` | S6 · `notification_prefs` (opt-in digest, frequency) + `alerts` (filing/insider targets), RLS 4 policies each, cap free 5 / pro 100, signup trigger opens the preference row |
| `0006_digest_marks` | S7 · per-reader digest marks on `notification_prefs` (`lang`, `filings_seen`, `filings_seen_acc`, `form4_seen`, `last_sent_at`); marks start today (no backlog burst); opt-ins reset for re-consent; signup trigger seeds the marks |
| `0007_subscribers` | S8 · `subscribers` for the lead magnets (newsletter, report, Excel, matcher, single-guru alert): double opt-in, unsubscribe token, consent record, per-guru marks; RLS on, service role only |
| `0005_job_triggers` | pg_cron + pg_net start the data workflows on the minute through GitHub `workflow_dispatch` (token in Vault `github_actions_dispatch`); `ops.dispatch_log` keeps GitHub's answer and the token's expiry, 3 retries; sends one test call (freshness) when applied |

## Apply to the live project

Use the **session pooler** connection string (Settings → Database → Connection
string → Session; IPv4, port 5432). The direct `db.<ref>.supabase.co` host is
IPv6-only on the free plan.

```bash
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
for f in migrations/0001_rls migrations/0002_constraints migrations/0003_stripe_events migrations/0004_alerts migrations/0005_job_triggers migrations/0006_digest_marks migrations/0007_subscribers; do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f "$f.up.sql"
done
```

`-1` wraps each file in one transaction: a migration either lands whole or not
at all. `0002` aborts itself, with the offending rows named, if `plan` holds a
value other than `free`/`pro` or two profiles share a Stripe id; fix the data
and re-run. Revert one step with the matching `.down.sql`.

## The dispatch token (`github_actions_dispatch`)

`0005` calls GitHub with a fine-grained personal access token kept in Vault.
The first one was made with the default 30-day life and expired on
2026-10-29 11:02 UTC; nothing said so, every call answered 401, and all five
jobs ran 5–6 hours late on the GitHub `schedule:` fallback for two days
(issue #154). Now every answer's `github-authentication-token-expiration`
header lands in `ops.dispatch_log.token_expires_at`, the cron hands it to
`freshness.yml` as `inputs.token_expires`, and `scripts/check-triggers.mjs`
raises the "Data jobs started late" alarm from **14 days before** the expiry.

**Make the token:** GitHub → Settings → Developer settings → Fine-grained
tokens → Generate. Resource owner `mustafakocer`, **only** this repository,
Repository permissions → **Actions: Read and write** (Metadata read comes
with it), nothing else. Expiration: **1 year** (custom date, the longest
GitHub allows) — put the renewal in the calendar a month before; the alarm
is the safety net, not the plan.

**Rotate it** (Supabase → SQL editor; the secret never goes in a file or a
commit):

```sql
-- replace the secret (keeps its id); create it if the row is gone
select vault.update_secret(
  (select id from vault.secrets where name = 'github_actions_dispatch'),
  'github_pat_…');
-- select vault.create_secret('github_pat_…', 'github_actions_dispatch', 'GitHub workflow_dispatch token for ops.dispatch (migrations/0005)');

-- one test call, then GitHub's answer: 204 = accepted, 401 = wrong token
select ops.dispatch('freshness.yml');
select pg_sleep(5);
select ops.collect_dispatches();
select id, workflow, requested_at, status, error, token_expires_at
  from ops.dispatch_log order by id desc limit 5;
```

A `Data freshness` run (event `workflow_dispatch`) appears in GitHub Actions
within a minute; the next cron-started one reports the new expiry in its
"Check the job start times" step and closes issue "Data jobs started late".
A missing row after five minutes means pg_cron is not running at all
(Integrations → Cron → Jobs; a paused project is the usual reason).

Applying `0005` again is safe (the schedules are replaced by name, the new
column is added if missing) but it sends one more test call. The
`token_expires` input must exist in `.github/workflows/freshness.yml` on
`main` before the new `ops.dispatch` runs — GitHub answers 422 to an input
the workflow does not declare.

## Test

```bash
npm run test:db            # temporary local Postgres (needs initdb on PATH, not root)
DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run test:db
```

`scripts/db-test.sh` lays `tests/sql/supabase-shim.sql` (API roles,
`auth.users`, `auth.uid()`) on a plain Postgres, applies every migration,
prints `pg_policies` before and after, runs `tests/sql/*.test.sql`, then walks
all migrations down and up twice. `.github/workflows/db-tests.yml` does the
same on every change to these files. `supabase db reset` would work the same
way if the CLI is set up locally; the shim replaces what the CLI's local stack
provides.
