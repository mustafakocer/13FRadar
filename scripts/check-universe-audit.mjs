// The nightly check after the universe build (universe.yml):
//   1. our total against each filer's declared total (cover page), in the
//      500 largest current funds: off by more than ±5%;
//   2. near-identical books (api/_data/copy-books.json, written by the build).
// Exits 3 when either finds something the previous night did not: the
// workflow then opens an alarm issue (scripts/notify.mjs). The state is kept
// in api/_data/universe-audit.json; nothing is ever added to
// config/misfiled-books.json here — that list is reviewed by hand.
//
//   node scripts/check-universe-audit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { completeQuarter } from '../api/_lib/universeSummary.js';
import { totalDeviations, newFindings, pairKey, NIGHTLY_TOP, NIGHTLY_TOLERANCE } from '../api/_lib/universeAudit.js';
import { misfiledBooks } from '../api/_lib/misfiledBooks.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const file = (...p) => path.join(root, ...p);
const read = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
};

const U = read(file('client/public/universe.json'), { rows: [] });
const copy = read(file('api/_data/copy-books.json'), { pairs: [] });
const stateFile = file('api/_data/universe-audit.json');
const known = read(stateFile, null);
const quarter = completeQuarter(U.updatedAt || new Date().toISOString());
const byCik = new Map(U.rows.map((r) => [r.cik, r]));
const $ = (v) => `$${(v / 1e9).toFixed(2)}B`;

const reviewed = new Set([
  ...misfiledBooks.filter((m) => m.copyOf).map((m) => pairKey(m.cik, m.copyOf)),
  ...(read(file('config/duplicate-books.json'), {}).pairs || []).filter((p) => p.keep && p.drop).map((p) => pairKey(p.keep, p.drop)),
]);

const withDeclared = U.rows.filter((r) => r.declared > 0).length;
// a universe written before the build read cover pages has nothing to judge:
// leave the state as it is
if (!withDeclared) {
  console.log('No declared totals in universe.json: nothing checked, state left as it was.');
  process.exit(0);
}
const deviations = totalDeviations(U.rows, { quarter });
const pairs = copy.pairs || [];
const fresh = known ? newFindings({ deviations, pairs }, known, reviewed) : { deviations: [], pairs: [] };

console.log(`Universe check (${quarter}): ${withDeclared} filers with a declared total; ${deviations.length} of the ${NIGHTLY_TOP} largest off by more than ±${NIGHTLY_TOLERANCE * 100}%; ${pairs.length} near-identical book pair(s).`);
if (!known) console.log('No previous state: this run is the baseline, nothing is raised.');
for (const d of deviations) console.log(`${fresh.deviations.includes(d) ? 'NEW ' : '    '}#${d.rank} ${d.name} (${d.cik}) ours ${$(d.aum)} vs declared ${$(d.declared)} (${d.diffPct > 0 ? '+' : ''}${d.diffPct}%) ${d.acc}`);
for (const p of pairs) {
  const a = byCik.get(p.a);
  const b = byCik.get(p.b);
  const tag = fresh.pairs.includes(p) ? 'NEW ' : reviewed.has(pairKey(p.a, p.b)) ? 'OK  ' : '    ';
  console.log(`${tag}pair ${a?.name || p.a} (${p.a}) ${a ? $(a.aum) : ''} / ${b?.name || p.b} (${p.b}) ${b ? $(b.aum) : ''}: ${p.matched} lines, ${(p.shareA * 100).toFixed(1)}% / ${(p.shareB * 100).toFixed(1)}%`);
}
for (const d of fresh.deviations) console.log(`::error::New total deviation: #${d.rank} ${d.name} (${d.cik}): ours ${$(d.aum)}, declared ${$(d.declared)} (${d.diffPct}%), filing ${d.acc}`);
for (const p of fresh.pairs) console.log(`::error::New near-identical books: ${byCik.get(p.a)?.name || p.a} (${p.a}) and ${byCik.get(p.b)?.name || p.b} (${p.b}), ${p.matched} lines. Review; config/misfiled-books.json or config/duplicate-books.json if it is a copy.`);

fs.writeFileSync(
  stateFile,
  `${JSON.stringify({ quarter, deviations: deviations.map((d) => `${d.cik}|${d.acc}`).sort(), pairs: pairs.map((p) => pairKey(p.a, p.b)).sort() }, null, 1)}\n`
);
if (fresh.deviations.length || fresh.pairs.length) process.exit(3);
