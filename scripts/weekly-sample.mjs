// The weekly sample check (weekly-sample.yml): ten funds, what the site
// shows next to the SEC information table, as an issue with a box per fund
// for a human to tick (api/_lib/sampleCheck.js). Commits nothing.
//
//   node scripts/weekly-sample.mjs            → opens the issue (GITHUB_TOKEN)
//   node scripts/weekly-sample.mjs --dry-run  → prints the issue instead
//   --scan-limit=N  scan only the N largest funds (a pull request's run)
//
// After the ten, every current fund without an amendment is checked the
// same way (about an hour at the EDGAR clock's pace); the funds that differ
// are listed under the sample.
//
// A week whose issue is already open is not opened twice. Exits 1 only when
// the issue could not be opened: a difference is for the human to look at,
// not a red run.
import fs from 'node:fs';
import path from 'node:path';
import { fetchInfoTableXml } from '../api/_lib/sec.js';
import { completeQuarter } from '../api/_lib/universeSummary.js';
import { githubIssues, mentionOf } from '../api/_lib/opsAlarm.js';
import { isoWeek, pickSample, rawLines, compareSample, sampleIssue } from '../api/_lib/sampleCheck.js';

export const SAMPLE_LABEL = 'haftalik-kontrol';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
const dry = process.argv.includes('--dry-run');

const U = read('client', 'public', 'universe.json');
const L = read('api', '_data', 'latest-holdings.json').byCik || {};
const S = read('api', '_data', 'slugs.json').byCik || {};
const week = process.env.SAMPLE_WEEK || isoWeek();
const quarter = completeQuarter(U.updatedAt || new Date().toISOString());

const funds = U.rows
  .filter((r) => L[r.cik]?.acc === r.acc)
  .map((r) => ({ cik: r.cik, name: S[r.cik]?.name || r.name, acc: r.acc, aum: r.aum, reportDate: r.reportDate || L[r.cik].reportDate, misfiled: Boolean(r.misfiled), amended: Boolean(L[r.cik].amendments?.length), slug: S[r.cik]?.slug, kind: S[r.cik]?.kind }));
const sample = pickSample(funds, { week, quarter });
console.log(`week ${week}, quarter ${quarter}: ${sample.length} of ${funds.length} funds`);

const results = [];
for (const fund of sample) {
  try {
    const raw = rawLines(await fetchInfoTableXml(fund.cik, fund.acc));
    const check = compareSample(L[fund.cik], raw);
    results.push({ fund, check });
    console.log(`${check.ok ? 'OK  ' : 'DIFF'} ${fund.name} (${fund.cik}) lines ${check.lines.filter((l) => l.ok).length}/${check.lines.length}, count ${check.count.ours}/${check.count.sec}`);
  } catch (e) {
    results.push({ fund, error: e.message });
    console.log(`FAIL ${fund.name} (${fund.cik}) ${e.message}`);
  }
}

// the whole universe, the same check
const limitArg = process.argv.find((a) => a.startsWith('--scan-limit='));
const scanLimit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const done = new Set(results.map((r) => r.fund.cik));
const eligible = funds.filter((f) => f.aum > 0 && !f.misfiled && !f.amended && (!quarter || f.reportDate >= quarter));
const toScan = eligible.filter((f) => !done.has(f.cik)).sort((a, b) => b.aum - a.aum).slice(0, scanLimit);
const scan = { checked: results.filter((r) => !r.error).length, unreadable: 0, skipped: funds.length - eligible.length, differs: results.filter((r) => !r.error && !r.check.ok) };
let next = 0;
let progress = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < toScan.length) {
      const fund = toScan[next++];
      try {
        const check = compareSample(L[fund.cik], rawLines(await fetchInfoTableXml(fund.cik, fund.acc)));
        scan.checked++;
        if (!check.ok) {
          scan.differs.push({ fund, check });
          console.log(`SCAN DIFF ${fund.name} (${fund.cik}) lines ${check.lines.filter((l) => l.ok).length}/${check.lines.length}, count ${check.count.ours}/${check.count.sec}`);
        }
      } catch (e) {
        scan.unreadable++;
      }
      if (++progress % 500 === 0) console.log(`  scanned ${progress}/${toScan.length}`);
    }
  })
);
console.log(`scan: ${scan.checked} checked, ${scan.differs.length} differ, ${scan.unreadable} unreadable, ${scan.skipped} skipped`);

const issue = sampleIssue({ week, results, mention: mentionOf(), scan });
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# ${issue.title}\n\n${issue.body}\n`);
if (dry) {
  console.log(`\n# ${issue.title}\n\n${issue.body}`);
  process.exit(0);
}
try {
  const issues = githubIssues({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY });
  const open = (await issues.openWithLabel(SAMPLE_LABEL)) || [];
  const same = open.find((i) => i.title === issue.title);
  if (same) {
    console.log(`issue #${same.number} for ${week} is already open: not opened twice`);
  } else {
    const made = await issues.create(issue.title, issue.body, [SAMPLE_LABEL]);
    console.log(`opened issue #${made.number} (${issue.failed} fund(s) with a difference)`);
  }
} catch (e) {
  console.error(`::error::the weekly sample issue could not be opened — ${e.message}`);
  process.exit(1);
}
