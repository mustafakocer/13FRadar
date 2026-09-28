// Tell a human that a data job failed — or that it recovered.
//
//   node scripts/notify.mjs --title "Insider ingest failed" --log build.log
//   node scripts/notify.mjs --title "Insider ingest failed" --resolve
//
// The channel is a GitHub issue that @mentions ALERT_MENTION (repository
// variable, default mustafakocer) — see api/_lib/opsAlarm.js. GitHub emails
// the mentioned account; nobody has to watch the repository.
//
// Email through Resend is kept as an optional second channel for later: it is
// used only when RESEND_API_KEY, ALERT_FROM and OPS_ALERT_EMAIL are all set,
// and its absence is not an error. What IS an error: the issue could not be
// opened or commented on (no token, no permission, API failure) — the run
// then exits 1, because an alarm nobody receives is the failure this exists
// to prevent. A failed --resolve only warns: the job itself was green.
import fs from 'node:fs';
import axios from 'axios';
import { githubIssues, mentionOf, raise, resolve } from '../api/_lib/opsAlarm.js';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const title = String(arg('title') || 'Data job failed');
const recovering = Boolean(arg('resolve'));
const logFile = arg('log');

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_WORKFLOW, GITHUB_TOKEN } = process.env;
const runUrl = GITHUB_REPOSITORY ? `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : null;
const mention = mentionOf();

// The lines worth reading: every ::error:: the job printed, then the tail.
function summarise(log, { maxErrors = 30, tail = 25 } = {}) {
  const lines = String(log || '').split('\n');
  const errors = lines.filter((l) => l.includes('::error::')).map((l) => l.replace(/^.*::error::/, '• ')).slice(0, maxErrors);
  return [...(errors.length ? ['Errors:', ...errors, ''] : []), 'Last lines of the log:', '```', ...lines.slice(-tail), '```'].join('\n');
}

let details = '';
if (logFile && fs.existsSync(logFile)) details = summarise(fs.readFileSync(logFile, 'utf8'));
const body = recovering
  ? `${GITHUB_WORKFLOW || 'The job'} ran green${runUrl ? ` — ${runUrl}` : ''}.`
  : [`**${GITHUB_WORKFLOW || 'A data job'}** failed at ${new Date().toISOString()}.`, runUrl ? `Run: ${runUrl}` : '', '', details].join('\n');

// optional channel — off unless fully configured
async function email() {
  const { RESEND_API_KEY: key, ALERT_FROM: from, OPS_ALERT_EMAIL: to } = process.env;
  if (!key || !from || !to) {
    console.log('email channel off (RESEND_API_KEY / ALERT_FROM / OPS_ALERT_EMAIL not all set) — the GitHub issue is the alarm');
    return;
  }
  const r = await axios.post(
    'https://api.resend.com/emails',
    { from, to: to.split(',').map((s) => s.trim()).filter(Boolean), subject: `[Fundocap] ALERT: ${title}`, text: body },
    { headers: { Authorization: `Bearer ${key}` }, validateStatus: () => true, timeout: 15000 }
  );
  if (r.status >= 300) console.warn(`::warning::email alert failed: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  else console.log(`email alert sent to ${to}`);
}

try {
  const issues = githubIssues({ token: GITHUB_TOKEN, repo: GITHUB_REPOSITORY });
  if (recovering) {
    const r = await resolve(issues, { title, body, mention });
    console.log(r.action === 'closed' ? `closed alarm issue #${r.number}` : 'no open alarm to close');
  } else {
    const r = await raise(issues, { title, body, mention });
    console.log(`${r.action === 'opened' ? 'opened' : 'commented on'} alarm issue #${r.number} (${mention})`);
    await email().catch((e) => console.warn(`::warning::email alert: ${e.message}`));
  }
} catch (e) {
  if (recovering) {
    console.warn(`::warning::could not close the alarm issue: ${e.message}`);
  } else {
    console.error(`::error::ALARM NOT DELIVERED — ${e.message}`);
    process.exit(1);
  }
}
