// The second source for insider trades (sec-dataset.yml): the SEC's own
// Insider Transactions Data Set against what the site holds
// (api/_lib/insiderDataset.js). Commits nothing.
//
//   node scripts/insider-dataset-check.mjs --latest
//        prints the newest data set as JSON ({ url, name, from, to })
//   node scripts/insider-dataset-check.mjs --dir <unzipped> --name <name> --from <date> --to <date> [--dry-run]
//        compares and opens one issue per data set (label kaynak-karsilastirma)
//
// A data set whose issue already exists, open or closed, is not raised
// twice: the SEC publishes one every quarter and the job runs weekly.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { secGet } from '../api/_lib/sec.js';
import { githubIssues, mentionOf } from '../api/_lib/opsAlarm.js';
import { columns } from '../api/_lib/secDataset.js';
import { classifyTransaction } from '../api/_lib/insiderModel.js';
import { normDate } from '../api/_lib/insiderForm4.js';
import { INSIDER_DATASET_PAGE, pickInsiderDatasets, datasetOf, secLine, compareAccession, insiderDatasetIssue } from '../api/_lib/insiderDataset.js';

export const DATASET_LABEL = 'kaynak-karsilastirma';
const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};

if (arg('latest')) {
  let newest = null;
  try {
    const { data } = await secGet(INSIDER_DATASET_PAGE, { responseType: 'text', transformResponse: [(d) => d] });
    [newest] = pickInsiderDatasets(data);
  } catch (e) {
    console.error(`::warning::the SEC's insider data set page could not be read (${e.message}); guessing the last quarter's file`);
  }
  if (!newest) {
    // the quarter before this one: the SEC's page lists nothing newer
    const now = new Date();
    const q = Math.floor(now.getUTCMonth() / 3) + 1;
    newest = q === 1 ? datasetOf(now.getUTCFullYear() - 1, 4) : datasetOf(now.getUTCFullYear(), q - 1);
  }
  console.log(JSON.stringify(newest));
  process.exit(0);
}

const dir = arg('dir');
const dataset = { name: String(arg('name') || ''), from: String(arg('from') || ''), to: String(arg('to') || '') };
if (!dir || !dataset.name || !dataset.from || !dataset.to) {
  console.error('usage: --dir <unzipped> --name <name> --from <date> --to <date>');
  process.exit(2);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const db = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'insiders.json'), 'utf8'));

// the site's rows filed inside the data set's window, by accession
const ours = new Map();
for (const r of db.rows || []) {
  if (!r.a || !r.f || r.f < dataset.from || r.f > dataset.to) continue;
  if (!ours.has(r.a)) ours.set(r.a, { cik: r.ci, t: r.t, n: r.n, rows: [] });
  ours.get(r.a).rows.push(r);
}
const allAccs = new Set((db.rows || []).map((r) => r.a));
// what the site keeps at all (scripts/build-insiders.mjs keepRow): a year of
// trades; sales and option exercises 120 days; grants and the like 90 days.
// A line older than that is not missing, it was let go.
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const built = Date.parse(db.updatedAt || new Date().toISOString());
const keepFrom = { conviction: day(built - 12 * 31 * 86400000), liquidity: day(built - 120 * 86400000), noise: day(built - 90 * 86400000) };
const firstFiled = (db.rows || []).reduce((m, r) => (r.f && (!m || r.f < m) ? r.f : m), null);

const file = (name) => {
  const f = fs.readdirSync(dir).find((x) => x.toUpperCase() === name);
  if (!f) {
    console.error(`::error::${name} not found in ${dir}`);
    process.exit(1);
  }
  return path.join(dir, f);
};
async function* tsv(name, required) {
  const rl = readline.createInterface({ input: fs.createReadStream(file(name)), crlfDelay: Infinity });
  let col = null;
  for await (const line of rl) {
    if (!col) {
      col = columns(line);
      for (const c of required) {
        if (col[c] == null) {
          console.error(`::error::${name} has no ${c} column`);
          process.exit(1);
        }
      }
      continue;
    }
    if (line) yield [line.split('\t'), col];
  }
}

// Form 4 and 4/A filings of the window, as the SEC lists them
const subs = new Map();
for await (const [f, col] of tsv('SUBMISSION.TSV', ['ACCESSION_NUMBER', 'FILING_DATE', 'DOCUMENT_TYPE'])) {
  const type = String(f[col.DOCUMENT_TYPE] || '').trim().toUpperCase();
  if (type !== '4' && type !== '4/A') continue;
  subs.set(f[col.ACCESSION_NUMBER], {
    filed: normDate(f[col.FILING_DATE]),
    cik: String(f[col.ISSUERCIK] ?? '').replace(/\D/g, '').padStart(10, '0'),
    t: col.ISSUERTRADINGSYMBOL != null ? String(f[col.ISSUERTRADINGSYMBOL] || '').trim().toUpperCase() || null : null,
  });
}

const sec = new Map();
const absent = [];
let total = 0;
for await (const [f, col] of tsv('NONDERIV_TRANS.TSV', ['ACCESSION_NUMBER', 'TRANS_CODE', 'TRANS_DATE', 'TRANS_SHARES', 'TRANS_PRICEPERSHARE'])) {
  total++;
  const acc = f[col.ACCESSION_NUMBER];
  const s = subs.get(acc);
  if (!s) continue;
  const line = secLine(f, col);
  if (ours.has(acc)) {
    (sec.get(acc) || sec.set(acc, []).get(acc)).push(line);
    continue;
  }
  // a purchase or a sale the site does not hold at all, inside what it keeps
  if (allAccs.has(acc) || (line.k !== 'P' && line.k !== 'S') || !(line.s > 0) || !line.d || !s.filed) continue;
  if (firstFiled && s.filed < firstFiled) continue;
  if (line.d < keepFrom[classifyTransaction(line.k)] || line.d > s.filed) continue;
  absent.push({ acc, cik: s.cik, t: s.t, k: line.k, d: line.d, s: line.s, p: line.p, filed: s.filed });
}
console.log(`SUBMISSION: ${subs.size} Form 4/4A; NONDERIV_TRANS: ${total} rows; ${sec.size} of ${ours.size} filings of ours in this data set`);

const results = [];
let missing = 0;
for (const [acc, o] of ours) {
  const check = compareAccession(o.rows, sec.get(acc));
  if (check.status === 'missing') {
    missing++;
    continue;
  }
  results.push({ acc, cik: o.cik, t: o.t, n: o.n, check });
}
absent.sort((a, b) => (b.s * (b.p || 0)) - (a.s * (a.p || 0)));
const issue = insiderDatasetIssue({ dataset, results, absent, skipped: { missing }, mention: mentionOf() });
console.log(`${issue.compared} filings (${issue.lineCount} lines) compared, ${issue.differs} differ (${issue.badLines} lines); ${issue.absent} purchase/sale lines absent from the site`);
const counts = {};
for (const r of results) for (const l of r.check.lines) if (l.issue) counts[l.issue] = (counts[l.issue] || 0) + 1;
console.log(`by issue: ${JSON.stringify(counts)}`);
for (const r of results.filter((x) => x.check.status === 'differs').slice(0, 60)) {
  for (const l of r.check.lines.filter((x) => x.issue)) console.log(`DIFF ${r.acc} ${r.t} ${l.issue} ours ${JSON.stringify({ k: l.ours.k, d: l.ours.d, s: l.ours.s, p: l.ours.p, o: l.ours.o })} sec ${JSON.stringify(l.sec)}`);
}
for (const a of absent.slice(0, 40)) console.log(`ABSENT ${a.acc} ${a.t} ${a.k} ${a.d} ${a.s} @ ${a.p} filed ${a.filed}`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# ${issue.title}\n\n${issue.body}\n`);
if (arg('dry-run')) process.exit(0);
try {
  const issues = githubIssues({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPOSITORY });
  const any = (await issues.anyWithLabel(DATASET_LABEL)) || [];
  const same = any.find((i) => i.title === issue.title);
  if (same) console.log(`issue #${same.number} for ${dataset.name} already exists: not raised twice`);
  else console.log(`opened issue #${(await issues.create(issue.title, issue.body, [DATASET_LABEL])).number}`);
} catch (e) {
  console.error(`::error::the comparison issue could not be opened — ${e.message}`);
  process.exit(1);
}
