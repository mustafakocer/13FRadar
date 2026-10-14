// Two checks on the current quarter of the universe, printed to the log and
// the job summary (audit-universe.yml; commits nothing):
//   1. our total per filing vs the filer's declared table value total
//   2. filers whose books are the same book (overlap > 90% both ways)
// Each filing is read the way the universe build reads it: the full table,
// its amendments applied (a RESTATEMENT replaces the declared total, NEW
// HOLDINGS add to it), the unit judged on every priced line. "Fresh" is that
// read; "stored" is universe.json. A stored total off by exactly ×1000 from
// the fresh one is a unit slip the stored copy missed (SLIP lines, applied
// by scripts/apply-audit.mjs). Only the rows outside ±1% are printed.
//
//   --deviations  only the filings the nightly check lists
//                 (api/_data/universe-audit.json), every one in a detail table
//   --ciks=a,b    only these filers
import fs from 'node:fs';
import path from 'node:path';
import { fetchInfoTableXml, fetchCoverPage, parse13F, aggregatePositions, getEffectiveHoldings, getSubmissions, list13FAll, filingIndex } from '../api/_lib/sec.js';
import { completeQuarter, inferPeriod } from '../api/_lib/universeSummary.js';
import { compareTotal, lineKey, overlapPairs, TOTAL_TOLERANCE, declaredCandidates, storedUnitSlip } from '../api/_lib/universeAudit.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const U = JSON.parse(fs.readFileSync(path.join(root, 'client', 'public', 'universe.json'), 'utf8'));
const L = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'latest-holdings.json'), 'utf8')).byCik || {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quarter = completeQuarter(U.updatedAt);
const argOf = (name) => process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const pad = (c) => String(c).replace(/\D/g, '').padStart(10, '0');
let only = null;
if (argOf('deviations')) {
  const state = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'universe-audit.json'), 'utf8'));
  only = new Set((state.deviations || []).map((k) => k.split('|')[0]));
}
if (argOf('ciks')) only = new Set(argOf('ciks').split('=')[1].split(',').filter(Boolean).map(pad));
const rows = U.rows.filter((r) => (r.reportDate || inferPeriod(r.filed)) >= quarter && r.aum > 0 && (!only || only.has(pad(r.cik))));
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
        const period = r.reportDate || inferPeriod(r.filed);
        const amends = (L[r.cik]?.acc === r.acc ? L[r.cik].amendments : null) || [];
        const cover = await fetchCoverPage(r.cik, r.acc);
        let agg;
        let rawRows = null;
        let declared = cover?.tableValueTotal ?? null;
        if (amends.length) {
          const filing = { acc: r.acc, filingDate: r.filed, reportDate: period, amendments: amends.map((a) => ({ acc: a.acc, filingDate: a.filingDate })) };
          agg = await getEffectiveHoldings(r.cik, filing);
          const covers = await Promise.all(amends.map((a) => fetchCoverPage(r.cik, a.acc)));
          // the reading closest to our total (a NEW HOLDINGS cover often
          // carries the period's cumulative total, not the added lines')
          const fresh0 = Math.round(agg.aum);
          const cands = declaredCandidates(declared, amends.map((a, k) => ({ type: covers[k]?.amendmentType || a.type, total: covers[k]?.tableValueTotal ?? null })));
          declared = cands.length ? cands.reduce((best, d) => (Math.abs(Math.log(fresh0 / d)) < Math.abs(Math.log(fresh0 / best)) ? d : best)) : null;
        } else {
          const parsed = await parse13F(await fetchInfoTableXml(r.cik, r.acc));
          rawRows = parsed.length;
          agg = aggregatePositions(parsed, r.filed, { period });
        }
        const factor = agg.unitFix?.factor || 1;
        const fresh = Math.round(agg.aum);
        const cmp = compareTotal({ ours: fresh, declared, factor });
        const stored = compareTotal({ ours: r.aum, declared, factor });
        const asStated = compareTotal({ ours: fresh, declared, factor: 1 });
        const slip = storedUnitSlip(r.aum, fresh);
        // asked for by name: what else the filer sent for the same period
        // and how many lines the cover says the table has, and which XML
        // documents the filing carries (a table split over two documents
        // is read as one only if the build reads both)
        let others = '';
        let entries = null;
        let docs = '';
        if (only) {
          try {
            const same = list13FAll(await getSubmissions(r.cik)).filter((f) => f.reportDate === period && f.acc !== r.acc);
            const parts = [];
            for (const f of same) {
              const c = await fetchCoverPage(r.cik, f.acc);
              parts.push(`${f.form} ${f.acc} ${f.filingDate}${c ? ` ${c.amendmentType || 'type?'} entries ${c.tableEntryTotal ?? '?'} total ${c.tableValueTotal ?? '?'}` : ''}${amends.some((a) => a.acc === f.acc) ? ' (applied)' : ' (NOT applied)'}`);
            }
            others = parts.join('; ');
          } catch (e) {
            others = `submissions unreadable: ${e.message}`;
          }
          entries = cover?.tableEntryTotal ?? null;
          try {
            const { items } = await filingIndex(r.cik, r.acc);
            docs = items.filter((it) => /\.xml$/i.test(it.name)).map((it) => `${it.name} ${it.size || '?'}`).join(', ');
          } catch (e) {
            docs = `index unreadable: ${e.message}`;
          }
        }
        const res = { entries, docs, rawRows, cik: r.cik, name: r.name, acc: r.acc, filed: r.filed, period, stored: r.aum, ours: fresh, declared, factor, amended: amends.length > 0, misfiled: Boolean(r.misfiled), slip, storedOk: stored.ok, asStatedOk: asStated.ok, others, lines: agg.positions.length, ...cmp };
        results.push(res);
        if (slip) console.log(`SLIP ${r.cik} ${r.acc} ${r.aum} ${fresh} ${slip}`);
        if (!cmp.ok || !stored.ok) console.log(`CMP ${r.cik} ${r.aum} ${fresh} ${declared ?? 'NA'} ${factor} ${cmp.diffPct == null ? 'NA' : cmp.diffPct.toFixed(5)} ${asStated.diffPct == null ? 'NA' : asStated.diffPct.toFixed(5)} ${amends.length}`);
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
const money = (v) => (v == null ? '—' : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(2)}M`);
const n = (f) => judged.filter(f).length;
const lines = [
  `## Universe audit — ${quarter}`,
  '',
  `Filings read: ${results.length} of ${rows.length}. With a declared total: ${judged.length}; none: ${results.length - judged.length}.`,
  '',
  `- Fresh read vs declared × unit factor: within ±${TOTAL_TOLERANCE * 100}% **${within} (${pct(within / judged.length)})**; outside ${judged.length - within}`,
  `- Stored (universe.json) vs declared × unit factor: within ${n((r) => r.storedOk)} (${pct(n((r) => r.storedOk) / judged.length)})`,
  `- Fresh read vs declared as stated (no factor on the cover): within ${n((r) => r.asStatedOk)} (${pct(n((r) => r.asStatedOk) / judged.length)})`,
  `- Fresh read vs either: within ${n((r) => r.ok || r.asStatedOk)} (${pct(n((r) => r.ok || r.asStatedOk) / judged.length)})`,
  `- Stored totals off by a unit (SLIP): ${results.filter((r) => r.slip).length}, $${(results.filter((r) => r.slip).reduce((s, r) => s + r.ours - r.stored, 0) / 1e9).toFixed(2)}B`,
  '',
];
lines.push('### Largest 20 differences (fresh vs declared × factor)', '', '| Fund | Ours | SEC × factor | SEC as stated | Diff | Amended |', '|---|---|---|---|---|---|');
for (const r of [...judged].filter((r) => !r.ok).sort((a, b) => Math.abs(b.ours - b.declaredAdj) - Math.abs(a.ours - a.declaredAdj)).slice(0, 20)) lines.push(`| ${r.name} | ${money(r.ours)} | ${money(r.declaredAdj)}${r.factor !== 1 ? ` (×${r.factor})` : ''} | ${money(r.declared)} | ${pct(r.diffPct)} | ${r.amended ? 'yes' : ''} |`);
lines.push('', '### Largest 20 funds', '', '| Fund | Ours | SEC × factor | Diff | Stored |', '|---|---|---|---|---|');
// the largest funds as ranked: a filing carrying another filer's table is not one
for (const r of [...results].filter((r) => !r.misfiled).sort((a, b) => b.ours - a.ours).slice(0, 20)) lines.push(`| ${r.name} | ${money(r.ours)} | ${money(r.declaredAdj ?? r.declared)} | ${r.diffPct == null ? '—' : pct(r.diffPct)} | ${money(r.stored)} |`);

if (only) {
  lines.push('', `### Every filing asked for (${results.length})`, '', '| Fund | CIK | Filing (filed) | Lines (rows read) | Cover lines | XML documents | Stored | Fresh | SEC as stated | Unit factor | Fresh vs SEC × factor | Fresh vs SEC as stated | Amended | SLIP | Other filings, same period |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of [...results].sort((a, b) => b.stored - a.stored)) lines.push(`| ${String(r.name).replace(/\|/g, '/')} | ${r.cik} | ${r.acc} (${r.filed}) | ${r.lines}${r.rawRows != null ? ` (${r.rawRows})` : ''} | ${r.entries ?? '—'} | ${r.docs} | ${money(r.stored)} | ${money(r.ours)} | ${money(r.declared)} | ${r.factor} | ${r.diffPct == null ? '—' : pct(r.diffPct)} | ${r.asStatedOk ? 'within' : 'outside'} | ${r.amended ? 'yes' : ''} | ${r.slip || ''} | ${r.others || ''} |`);
}
const pairs = overlapPairs(books).map((p) => ({ ...p, A: byCik.get(p.a), B: byCik.get(p.b) }));
pairs.sort((x, y) => Math.max(y.A.aum, y.B.aum) - Math.max(x.A.aum, x.B.aum));
lines.push('', `### Books that are the same book (> 90% of lines both ways): ${pairs.length} pairs`, '', '| Fund A | Fund B | A | B | Lines matched | A share | B share |', '|---|---|---|---|---|---|---|');
for (const p of pairs.slice(0, 30)) lines.push(`| ${p.A.name} (${p.a}) | ${p.B.name} (${p.b}) | ${money(p.A.aum)} | ${money(p.B.aum)} | ${p.matched} | ${pct(p.shareA)} | ${pct(p.shareB)} |`);
for (const p of pairs) console.log(`PAIR ${p.a} ${p.b} ${p.matched} ${p.shareA.toFixed(4)} ${p.shareB.toFixed(4)}`);
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
