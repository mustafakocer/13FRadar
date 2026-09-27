// Tell a human that a data job failed — or that it recovered.
//
//   node scripts/notify.mjs --title "Insider ingest failed" --log build.log
//   node scripts/notify.mjs --title "Insider ingest failed" --resolve
//
// Two channels, so an unset secret never means silence again (the freshness
// alarm was red for four days in September and nobody heard it):
//   1. Email through Resend — the provider the alert digests already use.
//      Needs RESEND_API_KEY, ALERT_FROM and OPS_ALERT_EMAIL.
//   2. A GitHub issue labelled `data-alarm`, opened once and commented on for
//      every further failure, closed by --resolve when the job is green again.
//      Needs only the workflow's GITHUB_TOKEN (issues: write); GitHub emails
//      the repository's watchers about it.
// Either channel failing is reported but never fails the job twice over.
import fs from 'node:fs';
import axios from 'axios';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const title = String(arg('title') || 'Data job failed');
const resolve = Boolean(arg('resolve'));
const logFile = arg('log');

const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_WORKFLOW, GITHUB_TOKEN } = process.env;
const runUrl = GITHUB_REPOSITORY ? `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}` : null;

// The lines worth reading: every ::error:: the job printed, then the tail.
function summarise(log, { maxErrors = 30, tail = 25 } = {}) {
  const lines = String(log || '').split('\n');
  const errors = lines.filter((l) => l.includes('::error::')).map((l) => l.replace(/^.*::error::/, '• ')).slice(0, maxErrors);
  return [...(errors.length ? ['Errors:', ...errors, ''] : []), 'Last lines of the log:', ...lines.slice(-tail)].join('\n');
}

let details = '';
if (logFile && fs.existsSync(logFile)) details = summarise(fs.readFileSync(logFile, 'utf8'));
const body = resolve
  ? `Recovered: ${GITHUB_WORKFLOW || 'the job'} ran green${runUrl ? ` — ${runUrl}` : ''}.`
  : [`${GITHUB_WORKFLOW || 'A data job'} failed at ${new Date().toISOString()}.`, runUrl ? `Run: ${runUrl}` : '', '', details].join('\n');

let failures = 0;

async function email() {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM;
  const to = process.env.OPS_ALERT_EMAIL;
  if (!key || !from || !to) {
    console.warn('::warning::email alert not sent — set RESEND_API_KEY, ALERT_FROM and OPS_ALERT_EMAIL in the repository secrets');
    return;
  }
  const r = await axios.post(
    'https://api.resend.com/emails',
    { from, to: to.split(',').map((s) => s.trim()).filter(Boolean), subject: `[Fundocap] ${resolve ? 'Recovered' : 'ALERT'}: ${title}`, text: body },
    { headers: { Authorization: `Bearer ${key}` }, validateStatus: () => true, timeout: 15000 }
  );
  if (r.status >= 300) {
    failures++;
    console.error(`::warning::email alert failed: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  } else console.log(`email alert sent to ${to}`);
}

async function issue() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.warn('::warning::no GITHUB_TOKEN — GitHub issue alert skipped');
    return;
  }
  const gh = axios.create({
    baseURL: `https://api.github.com/repos/${GITHUB_REPOSITORY}`,
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' },
    validateStatus: () => true,
    timeout: 15000,
  });
  const list = await gh.get('/issues', { params: { state: 'open', labels: 'data-alarm', per_page: 50 } });
  const open = Array.isArray(list.data) ? list.data.find((i) => i.title === title) : null;
  if (resolve) {
    if (!open) return;
    await gh.post(`/issues/${open.number}/comments`, { body });
    await gh.patch(`/issues/${open.number}`, { state: 'closed', state_reason: 'completed' });
    console.log(`closed alarm issue #${open.number}`);
    return;
  }
  const r = open
    ? await gh.post(`/issues/${open.number}/comments`, { body: body.slice(0, 60000) })
    : await gh.post('/issues', { title, body: body.slice(0, 60000), labels: ['data-alarm'] });
  if (r.status >= 300) {
    failures++;
    console.error(`::warning::GitHub issue alert failed: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  } else console.log(open ? `commented on alarm issue #${open.number}` : `opened alarm issue #${r.data.number}`);
}

// the recovery email is only worth sending when there was an open alarm
if (!resolve) await email().catch((e) => (failures++, console.error(`::warning::email alert: ${e.message}`)));
await issue().catch((e) => (failures++, console.error(`::warning::issue alert: ${e.message}`)));
if (failures) console.error(`${failures} alert channel(s) failed — see above`);
