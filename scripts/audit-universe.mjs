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
//   --amended     every current filing with a 13F-HR/A: a NEW HOLDINGS
//                 amendment that states names the original already carries,
//                 read both ways (its figure replaces the original's, or is
//                 added to it) against the covers' totals
// Asked for by name, a filer not yet reviewed (config/filing-notes.json,
// config/reviewed-deviations.json) also gets its last five 13F filings, each
// table read on its own against its cover, and its unpriced lines summed:
// whether the gap is new this quarter, and where the value sits.
import fs from 'node:fs';
import path from 'node:path';
import { fetchInfoTableXml, fetchCoverPage, parse13F, aggregatePositions, getEffectiveHoldings, getSubmissions, list13FAll, filingIndex } from '../api/_lib/sec.js';
import { completeQuarter, inferPeriod } from '../api/_lib/universeSummary.js';
import { defaultCloseOf } from '../api/_lib/valueUnits.js';
import { applyAmendment, restatesBook, NEW_HOLDINGS } from '../api/_lib/amendments.js';
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
const money = (v) => (v == null ? '—' : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(2)}M`);
const readJson = (...p) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
  } catch {
    return {};
  }
};
const reviewedKeys = new Set([...(readJson('config', 'filing-notes.json').notes || []), ...(readJson('config', 'reviewed-deviations.json').deviations || [])].map((x) => `${pad(x.cik)}|${x.acc}`));
if (argOf('amended')) {
  const lk = (p) => `${String(p.cusip || '').toUpperCase()}|${p.putCall || ''}`;
  const todo = U.rows.filter((r) => (r.reportDate || inferPeriod(r.filed)) >= quarter && L[r.cik]?.acc === r.acc && L[r.cik].amendments?.length);
  console.log(`amended filings: ${todo.length}`);
  const out = [];
  let k = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (k < todo.length) {
        const r = todo[k++];
        const period = r.reportDate || inferPeriod(r.filed);
        try {
          const read = async (acc, filed) => aggregatePositions(await parse13F(await fetchInfoTableXml(r.cik, acc)), filed, { period });
          const base = await read(r.acc, r.filed);
          const baseCover = await fetchCoverPage(r.cik, r.acc);
          let replace = { aum: base.aum, positions: base.positions };
          let add = { aum: base.aum, positions: base.positions };
          let coverSum = baseCover?.tableValueTotal ?? null;
          let repeated = 0;
          const parts = [];
          for (const a of [...L[r.cik].amendments].sort((x, y) => (x.filingDate < y.filingDate ? -1 : 1))) {
            const h = await read(a.acc, a.filingDate);
            const c = await fetchCoverPage(r.cik, a.acc);
            const type = c?.amendmentType || null;
            const nh = type === NEW_HOLDINGS && !restatesBook(replace, h);
            const have = new Set(replace.positions.map(lk));
            const rep = nh ? h.positions.filter((p) => have.has(lk(p))).length : 0;
            repeated += rep;
            replace = applyAmendment(replace, h, type);
            if (nh) {
              const m = new Map(add.positions.map((p) => [lk(p), { ...p }]));
              for (const p of h.positions) {
                const cur = m.get(lk(p));
                if (cur) m.set(lk(p), { ...cur, value: cur.value + p.value, shares: cur.shares + p.shares });
                else m.set(lk(p), { ...p });
              }
              add = { positions: [...m.values()], aum: [...m.values()].reduce((x, p) => x + p.value, 0) };
              if (coverSum != null && c?.tableValueTotal != null) coverSum += c.tableValueTotal;
            } else {
              add = { aum: replace.aum, positions: replace.positions };
              coverSum = c?.tableValueTotal ?? coverSum;
            }
            parts.push(`${type || 'type?'}${nh ? '' : type === NEW_HOLDINGS ? ' (read as restatement)' : ''} ${h.positions.length} lines ${money(h.aum)}${rep ? `, ${rep} repeated` : ''}`);
          }
          const off = (v) => (coverSum > 0 ? v / coverSum - 1 : null);
          out.push({ r, repeated, replace: replace.aum, add: add.aum, coverSum, offReplace: off(replace.aum), offAdd: off(add.aum), parts: parts.join('; ') });
        } catch (e) {
          console.log(`FAILED ${r.cik} ${r.acc} ${e.message}`);
        }
        await sleep(300);
      }
    })
  );
  const pc = (x) => (x == null ? '—' : `${(x * 100).toFixed(2)}%`);
  const within = (x) => x != null && Math.abs(x) <= 0.01;
  const withRep = out.filter((o) => o.repeated);
  const lines2 = [
    `## Amended filings — ${quarter}`,
    '',
    `Read: ${out.length}. With repeated names in a NEW HOLDINGS amendment: ${withRep.length}.`,
    `- of those, within ±1% of the covers' sum when the amendment's figure replaces: ${withRep.filter((o) => within(o.offReplace)).length}; when it is added: ${withRep.filter((o) => within(o.offAdd)).length}; neither: ${withRep.filter((o) => !within(o.offReplace) && !within(o.offAdd)).length}`,
    '',
    '| Fund | CIK | Filing | Amendments | Repeated | Replace | Add | Covers summed | Replace vs covers | Add vs covers |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const o of [...out].sort((a, b) => b.repeated - a.repeated || b.r.aum - a.r.aum)) lines2.push(`| ${String(o.r.name).replace(/\|/g, '/')} | ${o.r.cik} | ${o.r.acc} | ${o.parts.replace(/\|/g, '/')} | ${o.repeated} | ${money(o.replace)} | ${money(o.add)} | ${money(o.coverSum)} | ${pc(o.offReplace)} | ${pc(o.offAdd)} |`);
  console.log(lines2.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines2.join('\n')}\n`);
  process.exit(0);
}
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
        // asked for by name: every priced line against its period-end close.
        // A line written in the wrong unit sits near ×1000 or ÷1000 of it;
        // `fixedTotal` is the book with only those lines rescaled.
        let px = null;
        if (only) {
          const b = { priced: 0, ok: 0, high: [], low: [], off: 0, unpriced: [] };
          for (const p of agg.positions) {
            if (p.putCall || !(p.shares > 0) || !(p.value > 0)) {
              b.unpriced.push(p);
              continue;
            }
            const close = defaultCloseOf(p, period);
            if (!close) {
              b.unpriced.push(p);
              continue;
            }
            b.priced++;
            const ratio = p.value / p.shares / close;
            if (ratio >= 300 && ratio <= 3000) b.high.push({ p, ratio });
            else if (ratio <= 1 / 300 && ratio >= 1 / 3000) b.low.push({ p, ratio });
            else if (ratio >= 0.5 && ratio <= 2) b.ok++;
            else b.off++;
          }
          const highValue = b.high.reduce((s, x) => s + x.p.value, 0);
          const lowValue = b.low.reduce((s, x) => s + x.p.value, 0);
          const fixedTotal = Math.round(agg.aum - highValue + highValue / 1000 - lowValue + lowValue * 1000);
          const unpricedValue = b.unpriced.reduce((s2, p) => s2 + (p.value || 0), 0);
          const unpricedTop = [...b.unpriced].sort((x, y) => (y.value || 0) - (x.value || 0)).slice(0, 3).map((p) => `${p.issuer} ${money(p.value)}${p.shares ? ` / ${Math.round(p.shares).toLocaleString('en-US')} sh` : ''}`).join('; ');
          px = { unpriced: b.unpriced.length, unpricedValue, unpricedTop, priced: b.priced, ok: b.ok, off: b.off, high: b.high.length, highValue, low: b.low.length, lowValue, fixedTotal, fixedDiff: declared > 0 ? fixedTotal / declared - 1 : null, sample: [...b.high, ...b.low].sort((x, y) => y.p.value - x.p.value).slice(0, 3).map((x) => `${x.p.issuer} ${x.ratio.toFixed(0)}×`).join('; ') };
        }
        let history = null;
        if (only && !reviewedKeys.has(`${pad(r.cik)}|${r.acc}`)) {
          history = [];
          try {
            for (const f of list13FAll(await getSubmissions(r.cik)).slice(0, 6)) {
              const c = await fetchCoverPage(r.cik, f.acc).catch(() => null);
              let t = null;
              try {
                const parsed = await parse13F(await fetchInfoTableXml(r.cik, f.acc));
                const a = aggregatePositions(parsed, f.filingDate, { period: f.reportDate });
                t = { rows: parsed.length, lines: a.positions.length, sum: Math.round(a.aum), factor: a.unitFix?.factor || 1 };
              } catch (e) {
                t = { error: e.message };
              }
              history.push({ ...f, type: c?.amendmentType || null, coverEntries: c?.tableEntryTotal ?? null, coverTotal: c?.tableValueTotal ?? null, ...t });
            }
          } catch (e) {
            history.push({ error: `submissions unreadable: ${e.message}` });
          }
        }
        const res = { history, px, entries, docs, rawRows, cik: r.cik, name: r.name, acc: r.acc, filed: r.filed, period, stored: r.aum, ours: fresh, declared, factor, amended: amends.length > 0, misfiled: Boolean(r.misfiled), slip, storedOk: stored.ok, asStatedOk: asStated.ok, others, lines: agg.positions.length, ...cmp };
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
if (only) {
  lines.push('', '### Line prices against period-end closes (filings asked for)', '', '| Fund | CIK | Total ours | SEC declared | Diff | Priced | ≈1× | ×1000 lines (value) | ÷1000 lines (value) | Other off | Total with those lines rescaled | Then vs SEC | Largest | Unpriced lines (value) | Largest unpriced |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of [...results].filter((x) => x.px).sort((a, b) => b.stored - a.stored)) {
    const x = r.px;
    lines.push(`| ${String(r.name).replace(/\|/g, '/')} | ${r.cik} | ${money(r.ours)} | ${money(r.declared)} | ${r.diffPct == null ? '—' : pct(r.diffPct)} | ${x.priced} | ${x.ok} | ${x.high} (${money(x.highValue)}) | ${x.low} (${money(x.lowValue)}) | ${x.off} | ${money(x.fixedTotal)} | ${x.fixedDiff == null ? '—' : pct(x.fixedDiff)} | ${String(x.sample).replace(/\|/g, '/')} | ${x.unpriced} (${money(x.unpricedValue)}) | ${String(x.unpricedTop).replace(/\|/g, '/')} |`);
  }
}
if (only) {
  const open = results.filter((r) => r.history);
  lines.push('', `### Filing history of the filers not yet reviewed (${open.length})`, '');
  for (const r of open) {
    lines.push(`#### ${String(r.name).replace(/\|/g, '/')} (${r.cik})`, '', '| Filing | Form | Period | Filed | Type | Cover lines | Cover total | Table rows (lines) | Table sum | Unit factor | Table vs cover |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const h of r.history) {
      if (!h.acc) {
        lines.push(`| ${h.error} | | | | | | | | | | |`);
        continue;
      }
      const vs = h.sum > 0 && h.coverTotal > 0 ? pct(h.sum / (h.coverTotal * (h.factor || 1)) - 1) : '—';
      lines.push(`| ${h.acc}${h.acc === r.acc ? ' ◀' : ''} | ${h.form} | ${h.reportDate} | ${h.filingDate} | ${h.type || ''} | ${h.coverEntries ?? '—'} | ${money(h.coverTotal)} | ${h.error ? `unreadable: ${h.error}` : `${h.rows} (${h.lines})`} | ${money(h.sum)} | ${h.factor ?? ''} | ${vs} |`);
    }
    lines.push('');
  }
}
const pairs = overlapPairs(books).map((p) => ({ ...p, A: byCik.get(p.a), B: byCik.get(p.b) }));
pairs.sort((x, y) => Math.max(y.A.aum, y.B.aum) - Math.max(x.A.aum, x.B.aum));
lines.push('', `### Books that are the same book (> 90% of lines both ways): ${pairs.length} pairs`, '', '| Fund A | Fund B | A | B | Lines matched | A share | B share |', '|---|---|---|---|---|---|---|');
for (const p of pairs.slice(0, 30)) lines.push(`| ${p.A.name} (${p.a}) | ${p.B.name} (${p.b}) | ${money(p.A.aum)} | ${money(p.B.aum)} | ${p.matched} | ${pct(p.shareA)} | ${pct(p.shareB)} |`);
for (const p of pairs) console.log(`PAIR ${p.a} ${p.b} ${p.matched} ${p.shareA.toFixed(4)} ${p.shareB.toFixed(4)}`);
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
