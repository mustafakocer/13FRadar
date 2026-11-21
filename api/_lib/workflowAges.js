// Has every scheduled workflow succeeded recently? A dead man's switch.
//
// The data jobs raise their own alarm when they fail, and freshnessChecks.js
// reads the dates inside what they publish. Neither covers a job that
// publishes nothing the site serves — the e-mail alerts, the newsletter, the
// database backup, the weekly metrics mail — nor a job that stopped being
// started at all. metrics.yml failed every Monday (no METRICS_TO secret) and
// nothing said so.
//
// scripts/check-workflow-ages.mjs (a step of freshness.yml) asks GitHub for
// each workflow's last successful run on main and compares its age with the
// table below. Like a provider refusal (providerAlarm.js) an overdue job is
// reported ONCE: the first overdue check opens one issue per workflow, later
// checks stay quiet while it is open, and the first success closes it.
import { REPO } from './jobTriggers.js';

const HOUR = 3600_000;

// workflow file → the longest it may go without a successful run.
// Daily jobs get two days and weekly ones nine: GitHub's own scheduler starts
// them up to nine hours late, and one failed night that the next one repairs
// is the job's own alarm's business, not this one's. A run that skipped
// itself (conclusion "skipped") is not a success and does not count.
// freshness.yml cannot watch itself; see the note in its workflow file.
export const EXPECTED = [
  // the night chain — also watched by their own alarms and the data dates
  { workflow: 'universe.yml', maxAgeHours: 48, every: 'daily 01:23' },
  { workflow: 'consensus.yml', maxAgeHours: 48, every: 'daily, after universe' },
  { workflow: 'fpi.yml', maxAgeHours: 48, every: 'daily 02:47' },
  { workflow: 'insiders.yml', maxAgeHours: 36, every: 'twice a day' },
  { workflow: 'congress.yml', maxAgeHours: 48, every: 'twice a day (the Senate site refuses for days at a time)' },
  // jobs with no alarm of their own
  { workflow: 'domains.yml', maxAgeHours: 36, every: 'three times a day' },
  { workflow: 'logos.yml', maxAgeHours: 48, every: 'daily 08:41' },
  { workflow: 'alerts.yml', maxAgeHours: 48, every: 'daily 08:23 (filing e-mail alerts)' },
  { workflow: 'newsletter.yml', maxAgeHours: 48, every: 'daily 04:41' },
  { workflow: 'lighthouse.yml', maxAgeHours: 48, every: 'daily 12:17' },
  { workflow: 'tests.yml', maxAgeHours: 48, every: 'daily 09:07 on main (the full test suite)' },
  { workflow: 'site-check.yml', maxAgeHours: 72, every: 'after every production deployment (several a day)' },
  { workflow: 'db-backup.yml', maxAgeHours: 9 * 24, every: 'Mondays' },
  { workflow: 'metrics.yml', maxAgeHours: 9 * 24, every: 'Mondays' },
  { workflow: 'weekly-sample.yml', maxAgeHours: 9 * 24, every: 'Mondays' },
  { workflow: 'sec-dataset.yml', maxAgeHours: 9 * 24, every: 'Sundays' },
  { workflow: 'insider-raw-backfill.yml', maxAgeHours: 9 * 24, every: 'Sundays' },
];

export const AGE_ALARM_LABEL = 'data-alarm';
export const ageIssueTitle = (workflow) => `Zamanlanmış iş başarıyla çalışmıyor: ${workflow}`;

const fmtAge = (hours) => (hours >= 72 ? `${Math.floor(hours / 24)}d` : `${Math.floor(hours)}h`);

// Pure. `lastSuccess` maps a workflow file to the ISO time its last successful
// run was created, null when it has none, or undefined when GitHub could not
// be asked (then the row is `unknown`, neither ok nor overdue: a GitHub
// outage must not open sixteen alarms, nor close one).
export function judgeWorkflowAges({ now = Date.now(), lastSuccess = {}, expected = EXPECTED } = {}) {
  const t = +new Date(now);
  return expected.map(({ workflow, maxAgeHours, every }) => {
    const at = lastSuccess[workflow];
    if (at === undefined) return { workflow, status: 'unknown', what: `${workflow}: could not be read from GitHub` };
    if (at === null) return { workflow, status: 'overdue', what: `${workflow}: no successful run on record (runs ${every}; limit ${fmtAge(maxAgeHours)})` };
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) return { workflow, status: 'unknown', what: `${workflow}: last success "${at}" is not a date` };
    const hours = Math.max(0, (t - ms) / HOUR);
    const overdue = hours > maxAgeHours;
    return {
      workflow,
      status: overdue ? 'overdue' : 'ok',
      what: `${workflow}: last success ${new Date(ms).toISOString().slice(0, 16)}Z (${fmtAge(hours)} ago, limit ${fmtAge(maxAgeHours)}; runs ${every})`,
    };
  });
}

// What to do with each row, given the titles of the open alarm issues:
//   'open'     overdue, no issue yet — the one notification
//   'known'    overdue, already reported — stay quiet
//   'resolve'  succeeded again with an issue open — announce it
//   'ok'       nothing to do
//   'unknown'  GitHub did not answer for this workflow — leave its issue alone
export function ageActions(rows, openTitles) {
  const open = new Set(openTitles);
  return rows.map((r) => {
    const title = ageIssueTitle(r.workflow);
    if (r.status === 'unknown') return { ...r, title, action: 'unknown' };
    if (r.status === 'overdue') return { ...r, title, action: open.has(title) ? 'known' : 'open' };
    return { ...r, title, action: open.has(title) ? 'resolve' : 'ok' };
  });
}

// GitHub REST: the newest successful run of a workflow on main (token needs
// actions:read). Resolves to its created_at, or null when there is none.
export async function lastSuccessfulRun({ token, workflow, repo = REPO, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=main&status=success&per_page=1`;
  const res = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'fundocap-jobs',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} listing ${workflow} runs`);
  const body = await res.json();
  return body.workflow_runs?.[0]?.created_at ?? null;
}
