# migrations/

Migrations for the **live** Supabase project (`public.profiles`,
`public.watchlists`, `public.stripe_events`). Each one is an `up`/`down` pair,
plain SQL, safe to re-run. The opt-in historical store has its own single file
(`supabase/history-schema.sql`) and is not applied anywhere yet.

| File | What |
|---|---|
| `0000_baseline` | The schema as it already exists in production (2026-09-21). No-op on the live project; needed for an empty database. |
| `0001_rls` | S2 · policies, `is_pro()`, server-only billing columns, watchlist cap |
| `0002_constraints` | S3 · `plan` CHECK, `ls_customer_id` dropped, Stripe id UNIQUE, CIK normalisation |
| `0003_stripe_events` | S4 · webhook idempotency table + `apply_stripe_event()` |

## Apply to the live project

Use the **session pooler** connection string (Settings → Database → Connection
string → Session; IPv4, port 5432). The direct `db.<ref>.supabase.co` host is
IPv6-only on the free plan.

```bash
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
for f in migrations/0001_rls migrations/0002_constraints migrations/0003_stripe_events; do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f "$f.up.sql"
done
```

`-1` wraps each file in one transaction: a migration either lands whole or not
at all. `0002` aborts itself, with the offending rows named, if `plan` holds a
value other than `free`/`pro` or two profiles share a Stripe id; fix the data
and re-run. Revert one step with the matching `.down.sql`.

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
