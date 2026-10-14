// The second source (sec-dataset.yml): the SEC's own Form 13F data set
// against what the site shows (api/_lib/secDataset.js). Commits nothing.
//
//   node scripts/sec-dataset-check.mjs --latest
//        prints the newest data set as JSON ({ url, name, from, to })
//   node scripts/sec-dataset-check.mjs --dir <unzipped> --name <name> --from <date> --to <date> [--dry-run]
//        compares and opens one issue per data set (label kaynak-karsilastirma)
//
// A data set whose issue already exists, open or closed, is not raised
// twice: the SEC publishes one every quarter and the job runs weekly.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { secGet } from '../api/_lib/sec.js';
import { githubIssues, mentionOf } from '../api/_lib/opsAlarm.js';
import { DATASET_PAGE, pickDatasets, columns, newReading, addRow, compareFiling, datasetIssue } from '../api/_lib/secDataset.js';

export const DATASET_LABEL = 'kaynak-karsilastirma';
const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true;
};

if (arg('latest')) {
  const { data } = await secGet(DATASET_PAGE, { responseType: 'text', transformResponse: [(d) => d] });
  const [newest] = pickDatasets(data);
  if (!newest) {
    console.error('::error::no Form 13F data set link found on the SEC page');
    process.exit(1);
  }
  console.log(JSON.stringify(newest));
  process.exit(0);
}

const dir = arg('dir');
const dataset = { name: String(arg('name') || ''), from: String(arg('from') || ''), to: String(arg('to') || '') };
if (!dir || !dataset.name) {
  console.error('usage: --dir <unzipped> --name <name> --from <date> --to <date>');
  process.exit(2);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
const U = read('client', 'public', 'universe.json');
const L = read('api', '_data', 'latest-holdings.json').byCik || {};

// the filings the site uses, by accession; an amended one is skipped (the
// data set keeps each document apart, the site shows them folded)
const wanted = new Map();
let amended = 0;
for (const r of U.rows) {
  const e = L[r.cik];
  if (!e || e.acc !== r.acc || !(r.aum > 0)) continue;
  if (e.amendments?.length) {
    amended++;
    continue;
  }
  wanted.set(r.acc, { cik: r.cik, name: r.name, acc: r.acc, aum: e.aum, entry: e });
}

const file = fs.readdirSync(dir).find((f) => /^INFOTABLE\.tsv$/i.test(f));
if (!file) {
  console.error(`::error::INFOTABLE.tsv not found in ${dir}`);
  process.exit(1);
}
const readings = new Map();
let col = null;
let total = 0;
const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, file)), crlfDelay: Infinity });
for await (const line of rl) {
  if (!col) {
    col = columns(line);
    for (const c of ['ACCESSION_NUMBER', 'CUSIP', 'VALUE', 'SSHPRNAMT']) {
      if (col[c] == null) {
        console.error(`::error::INFOTABLE.tsv has no ${c} column`);
        process.exit(1);
      }
    }
    continue;
  }
  total++;
  const f = line.split('\t');
  const acc = f[col.ACCESSION_NUMBER];
  if (!wanted.has(acc)) continue;
  addRow(readings.get(acc) || readings.set(acc, newReading()).get(acc), { cusip: f[col.CUSIP], putCall: col.PUTCALL != null ? f[col.PUTCALL] : '', value: f[col.VALUE], shares: f[col.SSHPRNAMT] });
}
console.log(`INFOTABLE: ${total} rows; ${readings.size} of ${wanted.size} filings of ours in this data set; ${amended} amended skipped`);

const results = [];
let missing = 0;
for (const w of wanted.values()) {
  const check = compareFiling(w.entry, readings.get(w.acc));
  if (check.status === 'missing') {
    missing++;
    continue;
  }
  results.push({ fund: { cik: w.cik, name: w.name, acc: w.acc, aum: w.aum }, check });
}
const issue = datasetIssue({ dataset, results, skipped: { amended, missing }, mention: mentionOf() });
console.log(`${issue.compared} compared, ${issue.differs} differ`);
for (const r of results.filter((x) => x.check.status === 'differs').slice(0, 50)) {
  console.log(`DIFF ${r.fund.cik} ${r.fund.acc} ours ${r.fund.aum} sec ${Math.round(r.check.secValue)} count ${r.check.count.ours}/${r.check.count.sec} lines ${r.check.linesOk ? 'ok' : 'differ'}`);
}
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
