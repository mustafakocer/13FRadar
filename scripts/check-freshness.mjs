// Is every dataset the site serves actually current?
//
//   node scripts/check-freshness.mjs        (npm run check:freshness)
//
// Exits non-zero when any dataset is past its allowed age, so a scheduled run
// turns the workflow red instead of rotting quietly.
//
// The insider dataset sat four months stale behind green workflows because
// `updatedAt` is a write timestamp: the build rewrote the file every day while
// the crawl inside it fetched nothing. So where a dataset carries a date from
// the data itself, that is what gets checked; `updatedAt` is only a fallback
// for files with nothing better.
//
// Ages are per dataset, matched to how often each genuinely changes — a bound
// tight enough to catch a dead pipeline, loose enough not to cry wolf.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DAY = 86400000;

const CHECKS = [
  {
    file: 'api/_data/insiders.json',
    label: 'insider transactions',
    // the newest filing day in the data — the value that stops moving when the
    // EDGAR crawl stalls, which `updatedAt` alone would never reveal
    content: (j) => j.lastDay,
    maxContentDays: 5, // a weekend plus a federal holiday
    maxWrittenDays: 2, // the job runs daily
  },
  {
    file: 'client/public/insiders-teaser.json',
    label: 'insider teaser (public)',
    content: (j) => j.lastDay,
    maxContentDays: 5,
    maxWrittenDays: 2,
  },
  { file: 'client/public/consensus.json', label: 'consensus (public)', maxWrittenDays: 2 },
  { file: 'api/_data/consensus-pro.json', label: 'consensus (pro)', maxWrittenDays: 2 },
  { file: 'client/public/returns.json', label: 'price returns', maxWrittenDays: 2 },
  { file: 'client/public/guru-activity.json', label: 'guru activity (/report)', maxWrittenDays: 2 },
  { file: 'api/_data/related.json', label: 'related managers', maxWrittenDays: 2 },
  { file: 'api/_data/splits.json', label: 'share splits', maxWrittenDays: 2 },
  // The universe build rewrites updatedAt on every success, so a daily job
  // that has not touched these for a week has failed a week running — which is
  // what happened when a partial result had to be reverted by hand.
  { file: 'client/public/universe.json', label: '13F universe', maxWrittenDays: 7 },
  { file: 'client/public/stocks.json', label: 'stock directory', maxWrittenDays: 7 },
  { file: 'api/_data/slugs.json', label: 'filer slugs', maxWrittenDays: 7 },
  // No timestamp to check: the price enrichment is optional and empties itself
  // silently when FMP_API_KEY is unset, which blanks every price, market-cap
  // and volume column on the site.
  { file: 'api/_data/ticker-meta.json', label: 'ticker price meta', nonEmpty: true },
];

const ageDays = (value) => {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / DAY) : null;
};

const rows = [];
let failed = 0;
let warned = 0;

for (const c of CHECKS) {
  const full = path.join(root, c.file);
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    rows.push([c.label, 'MISSING', '—', err.message.slice(0, 40)]);
    failed++;
    continue;
  }

  if (c.nonEmpty) {
    const n = Object.keys(data).length;
    // A missing optional enrichment is a warning, not a failure: the site
    // degrades to hiding those columns rather than breaking.
    if (!n) {
      rows.push([c.label, 'EMPTY', '—', 'set FMP_API_KEY to populate']);
      warned++;
    } else {
      rows.push([c.label, 'ok', `${n} tickers`, '']);
    }
    continue;
  }

  const problems = [];
  const parts = [];

  if (c.content) {
    const value = c.content(data);
    const age = value == null ? null : ageDays(value);
    parts.push(`data through ${value ?? '—'}${age == null ? '' : ` (${age}d)`}`);
    if (age == null) problems.push('no content date');
    else if (age > c.maxContentDays) problems.push(`data is ${age}d old, limit ${c.maxContentDays}d`);
  }

  if (c.maxWrittenDays) {
    const age = data.updatedAt ? ageDays(data.updatedAt) : null;
    parts.push(`written ${data.updatedAt?.slice(0, 10) ?? '—'}${age == null ? '' : ` (${age}d)`}`);
    if (age == null) problems.push('no updatedAt');
    else if (age > c.maxWrittenDays) problems.push(`not rebuilt for ${age}d, limit ${c.maxWrittenDays}d`);
  }

  rows.push([c.label, problems.length ? 'STALE' : 'ok', parts.join(' · '), problems.join('; ')]);
  if (problems.length) failed++;
}

const w = (i) => Math.max(...rows.map((r) => r[i].length));
for (const r of rows) {
  console.log(`${r[0].padEnd(w(0))}  ${r[1].padEnd(6)}  ${r[2].padEnd(w(2))}  ${r[3]}`);
}

if (warned) console.log(`\n${warned} dataset(s) degraded but not fatal.`);
if (failed) {
  console.error(`\n${failed} dataset(s) stale or missing.`);
  process.exit(1);
}
console.log('\nAll datasets current.');
