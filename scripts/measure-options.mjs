// How much of each fund's latest 13F is option notional (put/call lines)?
// The home page's headline total leaves it out (api/_lib/universeSummary.js):
// a put or call line reports the value of the underlying shares, not an
// asset the fund owns, and a handful of market makers carry trillions of it.
//
//   node scripts/measure-options.mjs            # prints PCV lines + totals
//   node scripts/measure-options.mjs --apply out.log   # writes putCallValue
//                                                        into universe.json
//
// The universe build records putCallValue on every row from now on; this
// fills it in for the rows built before it did. Measuring reads each
// filing's info table once (the same documents the universe build reads,
// same pacing); applying reads the printed lines back without EDGAR.
import fs from 'node:fs';
import path from 'node:path';
import { fetchInfoTableXml, parse13F, aggregatePositions } from '../api/_lib/sec.js';
import { completeQuarter, inferPeriod, writeUniverseSummaryFile } from '../api/_lib/universeSummary.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const UFILE = path.join(root, 'client', 'public', 'universe.json');
const U = JSON.parse(fs.readFileSync(UFILE, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const applyAt = process.argv.indexOf('--apply');
if (applyAt > -1) {
  // PCV <cik> <acc> <value>
  const text = fs.readFileSync(process.argv[applyAt + 1], 'utf8');
  const got = new Map();
  for (const m of text.matchAll(/PCV (\d{10}) (\d{10}-\d{2}-\d{6}) (\d+)/g)) got.set(`${m[1]}|${m[2]}`, Number(m[3]));
  // every row the run set out to read, less the ones it could not
  const failed = new Set([...text.matchAll(/FAILED (\d{10}) (\d{10}-\d{2}-\d{6})/g)].map((m) => `${m[1]}|${m[2]}`));
  if (!/measuring \d+ filings/.test(text) || !/Option lines:/.test(text)) throw new Error('not a complete measure-options log');
  const quarter = completeQuarter(U.updatedAt);
  let set = 0;
  for (const r of U.rows) {
    const k = `${r.cik}|${r.acc}`;
    // a value the universe build recorded itself is never overwritten
    if ((r.reportDate || inferPeriod(r.filed)) < quarter || failed.has(k) || r.putCallValue != null) continue;
    r.putCallValue = got.get(k) || 0;
    set++;
  }
  fs.writeFileSync(UFILE, JSON.stringify(U));
  const s = writeUniverseSummaryFile(U, root);
  console.log(`putCallValue set on ${set} rows; headline $${(s.totalAum / 1e12).toFixed(2)}T (options excluded $${(s.optionsExcluded / 1e12).toFixed(2)}T)`);
  process.exit(0);
}

const quarter = completeQuarter(U.updatedAt);
const rows = U.rows.filter((r) => (r.reportDate || inferPeriod(r.filed)) >= quarter && r.putCallValue == null);
console.log(`measuring ${rows.length} filings (quarter ${quarter})`);
let i = 0;
let done = 0;
let failed = 0;
let total = 0;
const top = [];
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (i < rows.length) {
      const r = rows[i++];
      try {
        const parsed = await parse13F(await fetchInfoTableXml(r.cik, r.acc));
        const { positions } = aggregatePositions(parsed, r.filed, { period: r.reportDate || inferPeriod(r.filed) });
        const pcv = Math.round(positions.reduce((s, p) => s + (p.putCall ? p.value : 0), 0));
        if (pcv > 0) {
          console.log(`PCV ${r.cik} ${r.acc} ${pcv}`);
          total += pcv;
          top.push([r.name, pcv, r.aum]);
        }
      } catch (e) {
        failed++;
        console.log(`FAILED ${r.cik} ${r.acc} ${e.message}`);
      }
      if (++done % 500 === 0) console.log(`  ${done}/${rows.length} (failed ${failed})`);
      await sleep(450);
    }
  })
);
top.sort((a, b) => b[1] - a[1]);
const lines = [
  `## Option notional in the ${quarter} universe`,
  '',
  `${done - failed} of ${rows.length} filings read (${failed} failed). Option lines: **$${(total / 1e12).toFixed(2)}T**.`,
  '',
  '| Fund | Options | Whole filing |',
  '|---|---|---|',
  ...top.slice(0, 25).map(([n, v, a]) => `| ${n} | $${(v / 1e9).toFixed(0)}B | $${(a / 1e9).toFixed(0)}B |`),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
