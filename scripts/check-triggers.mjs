// Did every data job start on time over the last day? (api/_lib/
// jobTriggers.js checkSlots). Run by freshness.yml; exits 1 when a slot
// started more than 15 minutes late or not at all, or when the morning
// insider run did not follow fpi — the sign that the Supabase trigger
// (migrations/0005_job_triggers) stopped: token expired or revoked, the
// project paused, pg_cron off. The GitHub fallback still runs the jobs,
// hours late; this makes sure somebody hears about it.
import { TRIGGERS, checkSlots, listRuns } from '../api/_lib/jobTriggers.js';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, TRIGGERS_ACTIVE_FROM } = process.env;
const now = new Date();
const since = new Date(+now - 2 * 24 * 3600_000);
const workflows = [...new Set([...TRIGGERS.map((t) => t.workflow), 'insiders.yml'])];
const runsByWorkflow = {};
for (const w of workflows) runsByWorkflow[w] = await listRuns({ token: GITHUB_TOKEN, workflow: w, since, repo: GITHUB_REPOSITORY || undefined });

if (TRIGGERS_ACTIVE_FROM) console.log(`judging slots from ${TRIGGERS_ACTIVE_FROM}`);
const rows = checkSlots({ now, runsByWorkflow, activeFrom: TRIGGERS_ACTIVE_FROM || null });
for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.what}`);
const bad = rows.filter((r) => !r.ok);
if (bad.length) {
  for (const r of bad) console.log(`::error::${r.what}`);
  console.log('\nFix: Supabase → Integrations → Cron → Jobs (last run), and table ops.dispatch_log (HTTP status from GitHub). A 401 means the token in Vault (github_actions_dispatch) expired or was revoked.');
  process.exit(1);
}
