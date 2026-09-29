// Two checks on the current quarter of the universe, printed to the log and
// the job summary (audit-universe.yml; commits nothing):
//   1. our total per filing vs the filer's declared table value total
//   2. filers whose books are the same book (overlap > 90% both ways)
// Reads each filing's summary page and info table from EDGAR once.
import fs from 'node:fs';
import path from 'node:path';
import { fetchInfoTableXml, fetchCoverPage, parse13F, aggregatePositions } from '../api/_lib/sec.js';
import { completeQuarter, inferPeriod } from '../api/_lib/universeSummary.js';
import { compareTotal, lineKey, overlapPairs, TOTAL_TOLERANCE } from '../api/_lib/universeAudit.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const U = JSON.parse(fs.readFileSync(path.join(root, 'client', 'public', 'universe.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quarter = completeQuarter(U.updatedAt);
const rows = U.rows.filter((r) => (r.reportDate || inferPeriod(r.filed)) >= quarter && r.aum > 0);
console.log(`auditing ${rows.length} filings (quarter ${quarter})`);

const results = [];
const books = [];
let i = 0;
let done = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (i < rows.length) {
      const r = rows[i++];
      try {
        const [cover, xml] = await Promise.all([fetchCoverPage(r.cik, r.acc), fetchInfoTableXml(r.cik, r.acc)]);
        const period = r.reportDate || inferPeriod(r.filed);
        const agg = aggregatePositions(await parse13F(xml), r.filed, { period });
        const factor = agg.unitFix?.factor || 1;
        const cmp = compareTotal({ ours: r.aum, declared: cover?.tableValueTotal, factor });
        const res = { cik: r.cik, name: r.name, acc: r.acc, ours: r.aum, recomputed: Math.round(agg.aum), declared: cover?.tableValueTotal ?? null, factor, amended: Boolean(r.amendments || cover?.isAmendment), ...cmp };
        results.push(res);
        console.log(`CMP ${r.cik} ${r.aum} ${res.recomputed} ${res.declared ?? 'NA'} ${factor} ${res.diffPct == null ? 'NA' : res.diffPct.toFixed(5)}`);
        books.push({ id: r.cik, keys: agg.positions.map(lineKey) });
      } catch (e) {
        console.log(`FAILED ${r.cik} ${r.acc} ${e.message}`);
      }
      if (++done % 500 === 0) console.log(`  ${done}/${rows.length}`);
      await sleep(400);
    }
  })
);

const byCik = new Map(rows.map((r) => [r.cik, r]));
const judged = results.filter((r) => r.ok != null);
const within = judged.filter((r) => r.ok).length;
const pct = (x) => `${(x * 100).toFixed(2)}%`;
const money = (v) => (v == null ? '—' : `$${(v / 1e9).toFixed(2)}B`);
const lines = [`## Universe audit — ${quarter}`, '', `Filings read: ${results.length} of ${rows.length}. With a declared total: ${judged.length}. Within ±${TOTAL_TOLERANCE * 100}%: **${within} (${pct(within / judged.length)})**; outside: ${judged.length - within}. No declared total: ${results.length - judged.length}.`, ''];
lines.push('### Largest 20 differences', '', '| Fund | Ours | SEC (× factor) | Diff | Amended |', '|---|---|---|---|---|');
for (const r of [...judged].sort((a, b) => Math.abs(b.ours - b.declaredAdj) - Math.abs(a.ours - a.declaredAdj)).slice(0, 20)) lines.push(`| ${r.name} | ${money(r.ours)} | ${money(r.declaredAdj)}${r.factor !== 1 ? ` (×${r.factor})` : ''} | ${pct(r.diffPct)} | ${r.amended ? 'yes' : ''} |`);
lines.push('', '### Largest 20 funds', '', '| Fund | Ours | SEC | Diff |', '|---|---|---|---|');
for (const r of [...results].sort((a, b) => b.ours - a.ours).slice(0, 20)) lines.push(`| ${r.name} | ${money(r.ours)} | ${money(r.declaredAdj ?? r.declared)} | ${r.diffPct == null ? '—' : pct(r.diffPct)} |`);

const pairs = overlapPairs(books).map((p) => ({ ...p, A: byCik.get(p.a), B: byCik.get(p.b) }));
pairs.sort((x, y) => Math.max(y.A.aum, y.B.aum) - Math.max(x.A.aum, x.B.aum));
lines.push('', `### Books that are the same book (> 90% of lines both ways): ${pairs.length} pairs`, '', '| Fund A | Fund B | A | B | Lines matched | A share | B share |', '|---|---|---|---|---|---|---|');
for (const p of pairs.slice(0, 30)) lines.push(`| ${p.A.name} (${p.a}) | ${p.B.name} (${p.b}) | ${money(p.A.aum)} | ${money(p.B.aum)} | ${p.matched} | ${pct(p.shareA)} | ${pct(p.shareB)} |`);
for (const p of pairs) console.log(`PAIR ${p.a} ${p.b} ${p.matched} ${p.shareA.toFixed(4)} ${p.shareB.toFixed(4)}`);
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
