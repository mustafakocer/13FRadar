// Writes api/_data/splits-inferred.json: the share splits api/_data/splits.json
// does not list and the filings show (api/_lib/inferredSplits.js says how).
// Runs in the nightly consensus job before the guru history is rebuilt, from
// what is already on disk — last night's history, the split table and the
// price archive. No network.
//
// The file only changes when the list does, so a quiet night is no diff.
//
//   node scripts/build-inferred-splits.mjs            write the file
//   INFERRED_DRY=1 node scripts/build-inferred-splits.mjs   print, write nothing
import fs from 'node:fs';
import path from 'node:path';
import { inferSplits } from '../api/_lib/inferredSplits.js';
import { loadSplits } from '../api/_lib/splitAdjust.js';
import { closeOn } from '../api/_lib/valueUnits.js';

const root = process.cwd();
const HISTORY = process.env.GURU_HISTORY_FILE || path.join(root, 'api', '_data', 'guru-history.json');
const OUT = process.env.INFERRED_SPLITS_OUT || path.join(root, 'api', '_data', 'splits-inferred.json');

let history = null;
try {
  history = JSON.parse(fs.readFileSync(HISTORY, 'utf8'));
} catch {
  console.log(`inferred splits: no history at ${HISTORY} — nothing to read, file left as it is`);
  process.exit(0);
}

const { byTicker, rejected } = inferSplits(history, { table: loadSplits({ inferred: false }), closeOf: closeOn });
const list = Object.entries(byTicker).sort(([a], [b]) => a.localeCompare(b));
for (const [t, [s]] of list) {
  console.log(`inferred: ${t} ${s.ratio >= 1 ? `${Number(s.ratio.toPrecision(4))}-for-1` : `1-for-${Number((1 / s.ratio).toPrecision(4))}`} after ${s.evidence.from}${s.evidence.until ? `, by ${s.evidence.until}` : ' (no later report yet)'} — ${s.evidence.holders} holder(s), filed ÷ archived = ${s.evidence.residual}`);
}
console.log(`inferred splits: ${list.length} ticker(s); ${rejected.length} ticker(s) whose filed and archived prices disagree without being a split (a wrong series or mapping, not handled here)`);
for (const r of rejected.filter((x) => x.holders >= 2)) console.log(`  not a split: ${r.ticker} at ${r.date}, filed ÷ archived = ${r.residual} over ${r.holders} holders (${r.why})`);

let previous = null;
try {
  previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
} catch {
  /* first run */
}
const next = Object.fromEntries(list);
if (process.env.INFERRED_DRY === '1') process.exit(0);
if (previous && JSON.stringify(previous.byTicker) === JSON.stringify(next)) {
  console.log('inferred splits: unchanged');
  process.exit(0);
}
fs.writeFileSync(
  OUT,
  `${JSON.stringify({ updatedAt: new Date().toISOString(), note: 'Splits missing from splits.json, read off 13F implied prices (api/_lib/inferredSplits.js). Generated — do not edit.', byTicker: next }, null, 1)}\n`
);
console.log(`inferred splits: wrote ${path.relative(root, OUT)}`);
