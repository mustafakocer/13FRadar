// The weekly sample of trades (weekly-sample.yml): ten Form 4 filings and
// ten Congress reports, what the site shows next to the filing itself, as
// an issue with a box per filing for a human to tick
// (api/_lib/tradeSample.js). Commits nothing.
//
//   node scripts/weekly-sample-trades.mjs            → opens the issue (GITHUB_TOKEN)
//   node scripts/weekly-sample-trades.mjs --dry-run  → prints the issue instead
//
// A week whose issue is already open is not opened twice. Exits 1 only when
// the issue could not be opened: a difference is for the human to look at,
// not a red run.
import fs from 'node:fs';
import path from 'node:path';
import { secGet } from '../api/_lib/sec.js';
import { githubIssues, mentionOf } from '../api/_lib/opsAlarm.js';
import { isoWeek } from '../api/_lib/sampleCheck.js';
import { pickForm4s, pickReports, form4Lines, form4Url, compareAccession, tradeSampleIssue } from '../api/_lib/tradeSample.js';

export const SAMPLE_LABEL = 'haftalik-kontrol';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
const dry = process.argv.includes('--dry-run');
const week = process.env.SAMPLE_WEEK || isoWeek();

const insiders = read('api', '_data', 'insiders.json');
const congress = read('api', '_data', 'congress.json');
const filings = pickForm4s(insiders.rows || [], { week, now: insiders.updatedAt || new Date().toISOString() });
const reports = pickReports(congress.rows || [], { week, now: congress.updatedAt || new Date().toISOString() });
console.log(`week ${week}: ${filings.length} Form 4s, ${reports.length} Congress reports`);

const form4s = [];
for (const filing of filings) {
  try {
    const { data } = await secGet(form4Url(filing.cik, filing.acc), { responseType: 'text', transformResponse: [(d) => d] });
    const lines = form4Lines(data);
    if (!lines.length) throw new Error('no non-derivative lines in the filing');
    const check = compareAccession(filing.rows, lines);
    form4s.push({ filing, check });
    console.log(`${check.status === 'match' ? 'OK  ' : 'DIFF'} ${filing.t} ${filing.acc} ${check.lines.filter((l) => !l.issue).length}/${check.lines.length} lines`);
  } catch (e) {
    form4s.push({ filing, error: e.message });
    console.log(`FAIL ${filing.t} ${filing.acc} ${e.message}`);
  }
}

const issue = tradeSampleIssue({ week, form4s, reports, members: congress.members || {}, mention: mentionOf() });
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# ${issue.title}\n\n${issue.body}\n`);
if (dry) {
  console.log(`\n# ${issue.title}\n\n${issue.body}`);
  process.exit(0);
}
try {
  const issues = githubIssues({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY });
  const open = (await issues.openWithLabel(SAMPLE_LABEL)) || [];
  const same = open.find((i) => i.title === issue.title);
  if (same) console.log(`issue #${same.number} for ${week} is already open: not opened twice`);
  else console.log(`opened issue #${(await issues.create(issue.title, issue.body, [SAMPLE_LABEL])).number} (${issue.failed} Form 4(s) with a difference)`);
} catch (e) {
  console.error(`::error::the weekly trade sample issue could not be opened — ${e.message}`);
  process.exit(1);
}
