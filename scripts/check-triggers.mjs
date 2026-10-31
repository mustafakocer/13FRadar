// Did every data job start on time over the last day? (api/_lib/
// jobTriggers.js checkSlots). Run by freshness.yml; exits 1 when a slot
// started more than 15 minutes late or not at all, or when the morning
// insider run did not follow fpi — the sign that the Supabase trigger
// (migrations/0005_job_triggers) stopped: token expired or revoked, the
// project paused, pg_cron off. The GitHub fallback still runs the jobs,
// hours late; this makes sure somebody hears about it.
//
// Also exits 1 when the token is about to expire (TOKEN_EXPIRES, passed by
// the cron as inputs.token_expires: the expiry GitHub reported), two weeks
// ahead — the first token ran out on 2026-10-29 with no warning at all.
import { TRIGGERS, checkSlots, checkToken, listRuns } from '../api/_lib/jobTriggers.js';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, TRIGGERS_ACTIVE_FROM, TOKEN_EXPIRES } = process.env;
const now = new Date();
const since = new Date(+now - 2 * 24 * 3600_000);
const workflows = [...new Set([...TRIGGERS.map((t) => t.workflow), 'insiders.yml'])];
const runsByWorkflow = {};
for (const w of workflows) runsByWorkflow[w] = await listRuns({ token: GITHUB_TOKEN, workflow: w, since, repo: GITHUB_REPOSITORY || undefined });

if (TRIGGERS_ACTIVE_FROM) console.log(`judging slots from ${TRIGGERS_ACTIVE_FROM}`);
const rows = checkSlots({ now, runsByWorkflow, activeFrom: TRIGGERS_ACTIVE_FROM || null });
const token = checkToken({ now, expires: TOKEN_EXPIRES || null });
if (token) rows.push(token);
else console.log('token expiry unknown: this run was not started by the Supabase cron (the cron-started freshness runs carry it)');
for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.what}`);
const bad = rows.filter((r) => !r.ok);
if (bad.length) {
  for (const r of bad) console.log(`::error::${r.what}`);
  console.log(
    '\nFix: Supabase → SQL editor: `select id, workflow, requested_at, status, error, token_expires_at from ops.dispatch_log order by id desc limit 10;`' +
      ' and Integrations → Cron → Jobs (last run). No rows since the slot: pg_cron is not running (project paused?).' +
      ' A 401 means the Vault token github_actions_dispatch expired or was revoked: make a new fine-grained token and run the rotation SQL in migrations/README.md.'
  );
  process.exit(1);
}
