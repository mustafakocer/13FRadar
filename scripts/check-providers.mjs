// Turn this run's provider records into known-issue alarms.
//
//   node scripts/check-providers.mjs
//
// Reads api/_data/freshness/<provider>.json written by this workflow run
// (GITHUB_RUN_ID; every provider record when run by hand) and, per provider
// (api/_lib/providerAlarm.js → providerActions):
//   first refusal     → opens one known-issue GitHub issue with the @mention
//   still refusing    → ::warning:: only; no new notification; stays green
//   answering again   → closes its issue with a "çözüldü" comment (mentioned)
// Exits 1 only when GitHub itself refuses to take the alarm.
import fs from 'node:fs';
import path from 'node:path';
import { githubIssues, mentionOf, raise, resolve } from '../api/_lib/opsAlarm.js';
import { KNOWN_ISSUE_LABELS, providerActions } from '../api/_lib/providerAlarm.js';

const dir = path.join(process.cwd(), 'api', '_data', 'freshness');
const runId = process.env.GITHUB_RUN_ID || null;
const records = [];
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (!f.endsWith('.json')) continue;
  try {
    const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (r.kind === 'provider' && (!runId || r.run_id === runId)) records.push(r);
  } catch {
    /* not a record */
  }
}
if (!records.length) {
  console.log('no provider was called this run — nothing to report');
  process.exit(0);
}

let issues;
let openTitles = [];
try {
  issues = githubIssues({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY });
  const open = await issues.openWithLabel(KNOWN_ISSUE_LABELS[0]);
  openTitles = (Array.isArray(open) ? open : []).map((i) => i.title);
} catch (e) {
  console.error(`::error::cannot read the alarm issues — ${e.message}`);
  process.exit(1);
}

const mention = mentionOf();
const runUrl = process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`
  : '';
let failed = 0;
for (const a of providerActions(records, openTitles)) {
  try {
    if (a.action === 'open') {
      const body = [
        `**${a.provider}** refused requests in ${process.env.GITHUB_WORKFLOW || 'a data build'}: ${a.detail}`,
        runUrl && `Run: ${runUrl}`,
        '',
        'Known issue: while it lasts the nightly run stays green and nothing more is sent. This issue closes itself (with a mention) when the provider answers again.',
      ].filter(Boolean).join('\n');
      const r = await raise(issues, { title: a.title, body, mention, labels: KNOWN_ISSUE_LABELS });
      console.warn(`::warning::${a.provider} refusing — known issue #${r.number} opened`);
    } else if (a.action === 'known') {
      console.warn(`::warning::${a.provider} still refusing (known issue, already reported): ${a.detail}`);
    } else if (a.action === 'resolve') {
      const r = await resolve(issues, { title: a.title, body: runUrl && `Answering again — ${runUrl}`, mention, label: KNOWN_ISSUE_LABELS[0] });
      console.log(`${a.provider} answering again — issue #${r.number} closed`);
    } else {
      console.log(`${a.provider}: ok`);
    }
  } catch (e) {
    failed++;
    console.error(`::error::${a.provider}: alarm not delivered — ${e.message}`);
  }
}
if (failed) process.exit(1);
