// Live reconciliation of 13F books with the SEC filings themselves.
//
//   node scripts/reconcile-edgar.mjs                    the funds of config/reconcile-funds.json
//   node scripts/reconcile-edgar.mjs --ciks=1067983,…   these filers
//   node scripts/reconcile-edgar.mjs --sample=20        this week's seeded sample of 20 (sampleCheck.js)
//   --markdown   the table as Markdown (a pull request, the job summary)
//
// The weekly sample (scripts/weekly-sample.mjs) compares the share counts of
// the ten stored lines and the position count. This goes the rest of the
// way, for each fund's latest filing:
//
//   site ↔ pipeline   the entry the site stores (api/_data/latest-holdings.json:
//                     total, count, ten largest lines) against the full book the
//                     site's own code reads for that filing today
//                     (sec.js getEffectiveHoldings — what /api/holdings serves
//                     beyond the ten)
//   pipeline ↔ SEC    EVERY position of that book — shares, value, weight —
//                     against the information table read here with a parser of
//                     its own (sampleCheck.js rawLines), plus the count and the
//                     total. An amended period is compared with what the
//                     amendments make of it: a restatement's own table, or the
//                     original plus the new holdings.
//   SEC ↔ cover page  the table's sum against the total the filer declares
//
// Values are compared in the unit the site settled on: a filing it rescaled
// ×1000 (valueUnits.js) is listed with its factor, and the factor is checked
// against the cover page, not taken on trust. Tolerance: half a share, one
// dollar per line (rounding), a millionth on the total.
//
// Reads EDGAR (set SEC_USER_AGENT), writes nothing, commits nothing.
// Exits 1 when a fund differs or could not be read, so a workflow step can
// alarm on it.
import fs from 'node:fs';
import path from 'node:path';
import { fetchInfoTableXml, fetchCoverPage, getEffectiveHoldings, valueMultiplier } from '../api/_lib/sec.js';
import { rawLines, pickSample, isoWeek } from '../api/_lib/sampleCheck.js';
import { completeQuarter } from '../api/_lib/universeSummary.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (...p) => JSON.parse(fs.readFileSync(path.join(root, ...p), 'utf8'));
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const pad = (cik) => String(cik).replace(/\D/g, '').padStart(10, '0');

export const SHARE_TOLERANCE = 0.5;
export const VALUE_TOLERANCE = 1;
export const TOTAL_TOLERANCE = 1e-6;

const keyOf = (p) => `${String(p.cusip || '').toUpperCase()}|${p.putCall || ''}`;

// The book the filings make, from raw lines only: the original's table, then
// each amendment in filing order — a restatement replaces, new holdings are
// added (a line the book already carries at the same figure is the same line
// stated again). `tables`: [{ raw: Map, type: null | 'RESTATEMENT' | 'NEW HOLDINGS' }]
export function secBook(tables, unit) {
  let book = new Map();
  for (const t of tables) {
    const lines = new Map([...t.raw].map(([k, v]) => [k, { cusip: v.cusip, putCall: v.putCall || '', shares: v.shares, value: v.value * unit }]));
    if (!t.type || t.type === 'RESTATEMENT') {
      book = lines;
      continue;
    }
    for (const [k, v] of lines) {
      const cur = book.get(k);
      const near = (a, b) => (a > 0 && b > 0 ? Math.abs(a / b - 1) <= 0.02 : a === b);
      if (!cur) book.set(k, v);
      else if (!(near(cur.value, v.value) && near(cur.shares, v.shares))) book.set(k, { ...cur, shares: cur.shares + v.shares, value: cur.value + v.value });
    }
  }
  return book;
}

// One fund: { ok, notes: [], … } — pure, the caller does the reading.
//   stored    the site's entry (latest-holdings.json) or null
//   full      the pipeline's book { aum, positions, unitFix?, columnFix? }
//   sec       Map from secBook()
//   declared  the cover page's tableValueTotal × unit, or null
export function reconcile({ stored, full, sec, declared = null }) {
  const notes = [];
  // a line the filer wrote ×10 and the nightly check corrected
  // (lineCorrections.js): the filing's figure is restated the same way, and
  // the fund is listed with the correction, so it is seen and not hidden
  sec = new Map([...sec].map(([k, v]) => [k, { ...v }]));
  const fixed = full.positions.filter((p) => p.lineFix && sec.has(keyOf(p)));
  for (const p of fixed) sec.get(keyOf(p)).value *= p.lineFix.factor;
  if (fixed.length) notes.push(`${fixed.length} line(s) corrected by the site: ${fixed.map((p) => `${p.cusip} ×${p.lineFix.factor}`).join(', ')}`);
  const total = [...sec.values()].reduce((s, p) => s + p.value, 0);
  const lines = { checked: 0, bad: 0 };
  const seen = new Set();
  for (const p of full.positions) {
    const k = keyOf(p);
    const x = sec.get(k);
    lines.checked++;
    seen.add(k);
    const weight = total ? ((x?.value || 0) / total) * 100 : 0;
    const ok = x && Math.abs(p.shares - x.shares) <= SHARE_TOLERANCE && Math.abs(p.value - x.value) <= VALUE_TOLERANCE && Math.abs(p.weight - weight) <= 1e-6;
    if (!ok) {
      lines.bad++;
      if (notes.length < 5) notes.push(x ? `${k}: site ${p.shares} sh / $${Math.round(p.value)} / ${p.weight.toFixed(3)}% — SEC ${x.shares} sh / $${Math.round(x.value)} / ${weight.toFixed(3)}%` : `${k}: not in the filing`);
    }
  }
  for (const k of sec.keys()) {
    if (seen.has(k)) continue;
    lines.bad++;
    if (notes.length < 5) notes.push(`${k}: in the filing, missing from the book`);
  }
  const countOk = full.positions.length === sec.size;
  const totalOk = Math.abs(full.aum - total) <= Math.max(VALUE_TOLERANCE, total * TOTAL_TOLERANCE);
  if (!countOk) notes.push(`count: book ${full.positions.length}, filing ${sec.size}`);
  if (!totalOk) notes.push(`total: book $${Math.round(full.aum)}, filing $${Math.round(total)}`);

  // the stored entry against the book it was cut from
  let storedOk = null;
  if (stored) {
    const top = full.positions.slice(0, stored.top.length);
    const sameTop = stored.top.every((s, i) => {
      // the stored lines are the largest of the book; equal values may swap
      const p = full.positions.find((q) => keyOf(q) === keyOf(s));
      return p && Math.abs(p.shares - s.shares) <= SHARE_TOLERANCE && Math.abs(p.value - s.value) <= VALUE_TOLERANCE && Math.abs(p.weight - s.weight) <= 0.0006 && Math.abs((top[i]?.value ?? NaN) - s.value) <= VALUE_TOLERANCE;
    });
    storedOk = stored.count === full.positions.length && Math.abs(stored.aum - full.aum) <= Math.max(VALUE_TOLERANCE, full.aum * TOTAL_TOLERANCE) && sameTop;
    if (!storedOk) notes.push(`stored entry differs from the book: count ${stored.count}/${full.positions.length}, total $${stored.aum}/$${Math.round(full.aum)}${sameTop ? '' : ', top lines differ'}`);
  }
  // the filer's own declared total: informational when it is the filer who
  // is off (a cover-page typo is theirs, not ours), an error never
  const coverOk = declared == null ? null : Math.abs(total - declared) <= Math.max(2, declared * 1e-4);
  if (coverOk === false) notes.push(`cover page declares $${Math.round(declared)}, its table sums to $${Math.round(total)} (the filer's own inconsistency)`);
  return { ok: lines.bad === 0 && countOk && totalOk && storedOk !== false, lines, count: { book: full.positions.length, sec: sec.size, ok: countOk }, total: { book: full.aum, sec: total, ok: totalOk }, storedOk, coverOk, notes };
}

async function checkFund(cik, entry) {
  const filing = { acc: entry.acc, filingDate: entry.filed, reportDate: entry.reportDate, amendments: (entry.amendments || []).map((a) => ({ acc: a.acc, filingDate: a.filingDate })) };
  const full = await getEffectiveHoldings(cik, filing);
  // the filer's columns the other way round (valueUnits.js columnSwap): the
  // raw lines are read the way the site decided to read them
  const swap = Boolean(full.columnFix?.swapped);
  const unit = valueMultiplier(entry.filed) * (full.unitFix?.factor ?? entry.unitFix?.factor ?? 1);
  const tables = [];
  let declared = null;
  for (const [i, f] of [{ acc: entry.acc, type: null }, ...(full.amendments || []).map((a) => ({ acc: a.acc, type: a.type }))].entries()) {
    let raw = rawLines(await fetchInfoTableXml(cik, f.acc));
    if (swap) raw = new Map([...raw].map(([k, v]) => [k, { ...v, shares: v.value / valueMultiplier(entry.filed), value: v.shares * valueMultiplier(entry.filed) }]));
    tables.push({ raw, type: f.type });
    const cover = await fetchCoverPage(cik, f.acc);
    const v = cover?.tableValueTotal;
    if (v == null) declared = null;
    else if (i === 0 || f.type === 'RESTATEMENT') declared = v * unit;
    else if (declared != null) declared += v * unit;
  }
  const r = reconcile({ stored: entry, full, sec: secBook(tables, unit), declared: swap ? null : declared });
  return { ...r, factor: full.unitFix?.factor ?? 1, swapped: swap, amendments: (full.amendments || []).map((a) => a.type) };
}

const usd = (v) => (v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : `$${(v / 1e6).toFixed(1)}M`);
const mark = (v) => (v == null ? '—' : v ? 'ok' : 'DIFF');

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const latest = read('api', '_data', 'latest-holdings.json').byCik || {};
  const names = read('api', '_data', 'slugs.json').byCik || {};
  let ciks;
  if (args.ciks) ciks = String(args.ciks).split(',').map(pad);
  else if (args.sample) {
    const U = read('client', 'public', 'universe.json');
    const funds = U.rows.filter((r) => latest[r.cik]?.acc === r.acc).map((r) => ({ cik: r.cik, aum: r.aum, reportDate: r.reportDate || latest[r.cik].reportDate, misfiled: Boolean(r.misfiled), amended: false, slug: names[r.cik]?.slug, kind: names[r.cik]?.kind }));
    ciks = pickSample(funds, { week: process.env.SAMPLE_WEEK || isoWeek(), quarter: completeQuarter(U.updatedAt || new Date().toISOString()), size: Number(args.sample) || 10 }).map((f) => pad(f.cik));
  } else ciks = read('config', 'reconcile-funds.json').funds.map((f) => pad(f.cik));

  const rows = [];
  let failed = 0;
  for (const cik of ciks) {
    const entry = latest[cik];
    const name = names[cik]?.name || cik;
    if (!entry) {
      failed++;
      rows.push({ name, cik, error: 'not in latest-holdings.json' });
      continue;
    }
    try {
      const r = await checkFund(cik, entry);
      if (!r.ok) failed++;
      rows.push({ name, cik, entry, r });
    } catch (e) {
      failed++;
      rows.push({ name, cik, entry, error: e.message });
    }
  }

  const head = ['Fund', 'Period', 'Positions (site / SEC)', 'Total (site)', 'All lines: shares, value, weight', 'Stored top 10', 'Cover page', 'Note'];
  const body = rows.map(({ name, cik, entry, r, error }) =>
    error
      ? [`${name} (${cik})`, entry?.reportDate || '—', '—', '—', 'UNREAD', '—', '—', error]
      : [
          `${name} (${cik})`,
          entry.reportDate,
          `${r.count.book} / ${r.count.sec}`,
          usd(r.total.book),
          r.lines.bad ? `DIFF ${r.lines.bad} of ${r.lines.checked}` : `ok ${r.lines.checked}/${r.lines.checked}`,
          mark(r.storedOk),
          mark(r.coverOk),
          [r.factor !== 1 ? `values ×${r.factor}` : '', r.swapped ? 'columns swapped back' : '', r.amendments.length ? `amended: ${r.amendments.join(', ')}` : '', ...r.notes].filter(Boolean).join('; '),
        ]
  );
  const table = args.markdown || process.env.GITHUB_STEP_SUMMARY
    ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map((b) => `| ${b.map((c) => String(c).replace(/\|/g, '/')).join(' | ')} |`)].join('\n')
    : body.map((b) => b.join('  ·  ')).join('\n');
  const summary = `${rows.length} funds reconciled with EDGAR: ${rows.length - failed} match, ${failed} differ or could not be read`;
  console.log(`${table}\n\n${summary}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## 13F books against the SEC filings\n\n${table}\n\n${summary}\n`);
  if (failed) {
    console.error(`::error::${failed} of ${rows.length} fund(s) do not match their SEC filing`);
    process.exit(1);
  }
}
