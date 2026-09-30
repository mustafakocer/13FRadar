// First job of every data workflow: should this run do the work?
// (api/_lib/jobTriggers.js decideRun). Writes run=true|false to
// GITHUB_OUTPUT. If GitHub cannot be asked, the run goes ahead: a duplicate
// run costs minutes, a skipped one costs a day of data.
//
//   WORKFLOW=insiders.yml EVENT=schedule node scripts/run-guard.mjs
import fs from 'node:fs';
import { decideRun, isAutomatic, windowStart, WINDOWS, listRuns, builtOf } from '../api/_lib/jobTriggers.js';

const { WORKFLOW, EVENT, TRIGGER, GITHUB_TOKEN, GITHUB_RUN_ID, GITHUB_OUTPUT, GITHUB_REPOSITORY } = process.env;
const repo = GITHUB_REPOSITORY || undefined;
const now = new Date();

let decision;
try {
  const slots = WINDOWS[WORKFLOW];
  let runs = [];
  if (isAutomatic(EVENT, TRIGGER) && slots) {
    const from = windowStart(slots, now);
    const listed = await listRuns({ token: GITHUB_TOKEN, workflow: WORKFLOW, since: from, repo });
    for (const r of listed) {
      if (String(r.id) === String(GITHUB_RUN_ID) || r.status !== 'completed' || r.conclusion !== 'success') runs.push({ ...r, built: false });
      else runs.push({ ...r, built: await builtOf({ token: GITHUB_TOKEN, runId: r.id, repo }) });
    }
  }
  decision = decideRun({ workflow: WORKFLOW, event: EVENT, trigger: TRIGGER || null, now, runs, selfId: GITHUB_RUN_ID });
} catch (e) {
  decision = { run: true, reason: `could not check earlier runs (${e.message}); running` };
  console.log(`::warning::${decision.reason}`);
}

console.log(`${WORKFLOW} · ${EVENT}${TRIGGER ? ` (${TRIGGER})` : ''} → ${decision.run ? 'RUN' : 'SKIP'}: ${decision.reason}`);
if (GITHUB_OUTPUT) fs.appendFileSync(GITHUB_OUTPUT, `run=${decision.run}\n`);
