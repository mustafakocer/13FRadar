// Has every scheduled workflow succeeded recently? (api/_lib/workflowAges.js)
//
//   node scripts/check-workflow-ages.mjs            → opens / closes issues (GITHUB_TOKEN)
//   node scripts/check-workflow-ages.mjs --dry-run  → prints what it would do
//
// Run by freshness.yml. An overdue workflow gets one GitHub issue with the
// @mention (the notification); while it stays overdue nothing more is sent;
// its first successful run closes the issue. The step itself stays green —
// it exits 1 only when GitHub could not be asked at all or refused to take an
// alarm, because an alarm nobody receives is the failure this exists to
// prevent.
import { githubIssues, mentionOf, raise, resolve } from '../api/_lib/opsAlarm.js';
import { AGE_ALARM_LABEL, EXPECTED, ageActions, judgeWorkflowAges, lastSuccessfulRun } from '../api/_lib/workflowAges.js';

const dry = process.argv.includes('--dry-run');
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SERVER_URL } = process.env;
const repo = GITHUB_REPOSITORY || undefined;

const lastSuccess = {};
let unread = 0;
for (const { workflow } of EXPECTED) {
  try {
    lastSuccess[workflow] = await lastSuccessfulRun({ token: GITHUB_TOKEN, workflow, repo });
  } catch (e) {
    unread++;
    console.warn(`::warning::${workflow}: ${e.message}`);
  }
}
const rows = judgeWorkflowAges({ lastSuccess });
for (const r of rows) console.log(`${r.status === 'ok' ? 'OK  ' : r.status === 'overdue' ? 'LATE' : '??  '} ${r.what}`);
if (unread === EXPECTED.length) {
  console.error('::error::no workflow could be read from GitHub — the check did not run');
  process.exit(1);
}
if (dry) process.exit(0);

let issues;
let openTitles = [];
try {
  issues = githubIssues({ token: GITHUB_TOKEN, repo: GITHUB_REPOSITORY });
  const open = await issues.openWithLabel(AGE_ALARM_LABEL);
  openTitles = (Array.isArray(open) ? open : []).map((i) => i.title);
} catch (e) {
  console.error(`::error::cannot read the alarm issues — ${e.message}`);
  process.exit(1);
}

const mention = mentionOf();
const actionsUrl = (workflow) => (GITHUB_REPOSITORY ? `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/workflows/${workflow}` : '');
let failed = 0;
for (const a of ageActions(rows, openTitles)) {
  try {
    if (a.action === 'open') {
      const body = [
        `**${a.workflow}** has not finished successfully within its limit.`,
        a.what,
        actionsUrl(a.workflow) && `Runs: ${actionsUrl(a.workflow)}`,
        '',
        'Reported once: nothing more is sent while it lasts, and this issue closes itself (with a mention) on the next successful run.',
      ].filter(Boolean).join('\n');
      const r = await raise(issues, { title: a.title, body, mention, labels: [AGE_ALARM_LABEL] });
      console.warn(`::warning::${a.workflow} overdue — issue #${r.number} opened`);
    } else if (a.action === 'known') {
      console.warn(`::warning::${a.workflow} still overdue (already reported): ${a.what}`);
    } else if (a.action === 'resolve') {
      const r = await resolve(issues, { title: a.title, body: a.what, mention, label: AGE_ALARM_LABEL });
      console.log(`${a.workflow} succeeded again — issue #${r.number} closed`);
    }
  } catch (e) {
    failed++;
    console.error(`::error::${a.workflow}: alarm not delivered — ${e.message}`);
  }
}
if (failed) process.exit(1);
