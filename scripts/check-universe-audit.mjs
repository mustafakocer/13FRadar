// The nightly check after the universe build (universe.yml):
//   1. our total against each filer's declared total (cover page), in the
//      500 largest current funds: off by more than ±5%;
//   2. near-identical books (api/_data/copy-books.json, written by the build).
// Exits 3 when either finds something the previous night did not: the
// workflow then opens an alarm issue (scripts/notify.mjs). The state is kept
// in api/_data/universe-audit.json, and every deviation of the night, new or
// not, is listed for a human in reports/kaynak-sapmalari.md; nothing is ever added to
// config/misfiled-books.json here — that list is reviewed by hand.
//
//   node scripts/check-universe-audit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { completeQuarter, writeUniverseSummaryFile } from '../api/_lib/universeSummary.js';
import { totalDeviations, newFindings, pairKey, copyAdvice, adviceLine, deviationReport, filingUrl, NIGHTLY_TOLERANCE } from '../api/_lib/universeAudit.js';
import { getSubmissions, list13FAll, getEffectiveHoldings, getHoldings, fetchCoverPage, fetchInfoTableXml, parse13F } from '../api/_lib/sec.js';
import { defaultCloseOf } from '../api/_lib/valueUnits.js';
import { findLineSlips, applyLineFixes, autoReview, lineKey } from '../api/_lib/deviationFix.js';
import { misfiledBooks } from '../api/_lib/misfiledBooks.js';
import { filingNotes } from '../api/_lib/filingNotes.js';
import { fundFlags } from '../api/_lib/fundFlags.js';

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
const reportPath = 'reports/kaynak-sapmalari.md';
const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_REF_NAME } = process.env;
const reportUrl = GITHUB_REPOSITORY ? `${GITHUB_SERVER_URL || 'https://github.com'}/${GITHUB_REPOSITORY}/blob/${GITHUB_REF_NAME || 'main'}/${reportPath}` : reportPath;

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
let deviations = totalDeviations(U.rows, { quarter });

// ---- what the check settles by itself (api/_lib/deviationFix.js) ----------
// For a deviation no person has closed: lines the filer wrote ×10 are divided
// by ten when that reconciles the table with the cover (kept in
// api/_data/line-corrections.json and applied wherever the filing is read),
// and a deviation the evidence closes is closed (api/_data/auto-reviews.json).
// EDGAR unreachable or a table unreadable: the deviation stays open.
const L = read(file('api/_data/latest-holdings.json'), null);
const lineFile = file('api/_data/line-corrections.json');
const autoFile = file('api/_data/auto-reviews.json');
const handReviewed = read(file('config/reviewed-deviations.json'), {}).deviations || [];
const handNotes = filingNotes.filter((n) => !n.auto);
const kOf = (cik, acc) => `${String(cik).replace(/\D/g, '').padStart(10, '0')}|${acc}`;
const closedByHand = new Set([...handNotes, ...handReviewed].map((n) => kOf(n.cik, n.acc)));
const currentAcc = new Map(U.rows.map((r) => [r.cik, r.acc]));
// a closing stands while the filing and its total are the ones it was made on
const autoReviews = (read(autoFile, {}).reviews || []).filter((a) => currentAcc.get(a.cik) === a.acc && Math.abs((byCik.get(a.cik)?.aum || 0) / (a.table || 1) - 1) <= 0.005);
const autoClosed = new Set(autoReviews.map((a) => kOf(a.cik, a.acc)));
// a correction is kept while its filer is in the universe (an older
// filing's correction still serves that filing's page and history)
const lineCorrections = (read(lineFile, {}).corrections || []).filter((c) => currentAcc.has(c.cik));
let changedRows = false;
// the stored copies of tonight's build: the universe row and the filer's top
// lines (latest-holdings.json); the next build reads the fix itself
const patchRow = (row, fixes) => {
  const before = row.aum;
  row.aum = Math.round(row.aum - fixes.reduce((s, f) => s + f.value * (1 - f.factor), 0));
  const e = L?.byCik?.[row.cik];
  if (e && e.acc === row.acc) {
    const fixed = applyLineFixes({ aum: e.aum, positions: e.top || [] }, fixes);
    e.aum = row.aum;
    e.top = fixed.positions.map((p) => ({ ...p, weight: Number(((p.value / row.aum) * 100).toFixed(3)) }));
    row.top10 = Number(e.top.slice(0, 10).reduce((s, p) => s + p.weight, 0).toFixed(1));
  }
  changedRows = true;
  return before;
};
const today = new Date().toISOString().slice(0, 10);
for (const d of deviations) {
  const key = kOf(d.cik, d.acc);
  if (closedByHand.has(key) || autoClosed.has(key)) continue;
  const row = byCik.get(d.cik);
  if (!row || row.acc !== d.acc) continue;
  try {
    const amendments = L?.byCik?.[row.cik]?.acc === row.acc ? L.byCik[row.cik].amendments || [] : [];
    const agg = await getEffectiveHoldings(row.cik, { acc: row.acc, filingDate: row.filed, reportDate: row.reportDate, amendments: amendments.map((a) => ({ acc: a.acc, filingDate: a.filingDate })) });
    let prev = new Map();
    if (row.ref?.acc) {
      try {
        const p = await getHoldings(row.cik, row.ref.acc, row.ref.filed, row.ref.reportDate || null);
        prev = new Map(p.positions.filter((x) => x.shares > 0 && x.value > 0).map((x) => [lineKey(x), x.value / x.shares]));
      } catch {
        /* no previous filing: closes only */
      }
    }
    let positions = agg.positions.map((p) => ({ ...p, close: p.putCall || p.prn ? null : defaultCloseOf(p, row.reportDate), prevPx: prev.get(lineKey(p)) || null }));
    // only a read that agrees with the stored total may correct it
    const slips = Math.abs(agg.aum / row.aum - 1) <= 0.001 ? findLineSlips(positions, { declared: [row.declared, ...(row.declaredAlt || [])], tolerance: NIGHTLY_TOLERANCE }) : null;
    if (slips) {
      const lines = slips.fixes.map((f) => ({ ...f, issuer: agg.positions.find((p) => lineKey(p) === lineKey(f))?.issuer || null }));
      lineCorrections.push({ cik: row.cik, name: row.name, acc: row.acc, period: row.reportDate, before: Number(slips.before.toFixed(4)), after: Number(slips.after.toFixed(4)), lines, at: today });
      const was = patchRow(row, slips.fixes);
      console.log(`LINE FIX ${row.name} (${row.cik}) ${row.acc}: ${lines.length} line(s) ÷10, $${(was / 1e6).toFixed(1)}M → $${(row.aum / 1e6).toFixed(1)}M (cover $${(row.declared / 1e6).toFixed(1)}M)`);
      positions = applyLineFixes({ aum: agg.aum, positions }, slips.fixes).positions;
    }
    if (amendments.length) continue; // an amended filing is a person's call
    const [cover, raw] = await Promise.all([fetchCoverPage(row.cik, row.acc), fetchInfoTableXml(row.cik, row.acc).then(parse13F)]);
    const priced = positions.filter((p) => p.close > 0 && p.shares > 0);
    const atClose = priced.filter((p) => Math.abs(p.value / p.shares / p.close - 1) <= 0.1).length;
    const review = autoReview({ aum: row.aum, putCallValue: row.putCallValue || 0, declared: row.declared, rows: raw.length, entries: cover?.tableEntryTotal ?? null, priced: priced.length, atClose, prevAum: row.ref?.aum, period: row.reportDate });
    if (review) {
      autoReviews.push({ cik: row.cik, acc: row.acc, kind: review.kind, declared: row.declared, table: row.aum, reason: review.reason, at: today });
      autoClosed.add(key);
      console.log(`AUTO ${review.kind} ${row.name} (${row.cik}) ${row.acc}: ${review.reason}`);
    }
  } catch (e) {
    console.log(`could not check ${row.name} (${row.cik}) ${row.acc}: ${e.message}`);
  }
}
if (changedRows) {
  U.rows.sort((a, b) => b.aum - a.aum);
  fs.writeFileSync(file('client/public/universe.json'), JSON.stringify(U));
  if (L) fs.writeFileSync(file('api/_data/latest-holdings.json'), JSON.stringify(L));
  writeUniverseSummaryFile(U, root);
  deviations = totalDeviations(U.rows, { quarter });
}
fs.writeFileSync(lineFile, `${JSON.stringify({ _readme: 'Lines a filer wrote ten times too large, divided by ten by the nightly check (api/_lib/deviationFix.js findLineSlips) and applied wherever the filing is read (sec.js getHoldings). One entry per filing.', corrections: lineCorrections }, null, 1)}\n`);
fs.writeFileSync(autoFile, `${JSON.stringify({ _readme: 'Deviations from reports/kaynak-sapmalari.md closed by the nightly check itself (api/_lib/deviationFix.js autoReview). A hand entry in config/filing-notes.json or config/reviewed-deviations.json for the same filing wins. Dropped when the filer sends a newer filing or the total changes.', reviews: autoReviews }, null, 1)}\n`);
const lineFixesNow = lineCorrections.filter((c) => currentAcc.get(c.cik) === c.acc);
const pairs = copy.pairs || [];
// a deviation the check closed by itself raises no alarm
const fresh = known ? newFindings({ deviations: deviations.filter((d) => !autoClosed.has(kOf(d.cik, d.acc))), pairs }, known, reviewed) : { deviations: [], pairs: [] };

console.log(`Universe check (${quarter}): ${withDeclared} filers with a declared total; ${deviations.length} current fund(s) off by more than ±${NIGHTLY_TOLERANCE * 100}%; ${pairs.length} near-identical book pair(s).`);
if (!known) console.log('No previous state: this run is the baseline, nothing is raised.');
for (const d of deviations) console.log(`${fresh.deviations.includes(d) ? 'NEW ' : '    '}#${d.rank} ${d.name} (${d.cik}) ours ${$(d.aum)} vs declared ${$(d.declared)} (${d.diffPct > 0 ? '+' : ''}${d.diffPct}%) ${d.acc}`);
for (const p of pairs) {
  const a = byCik.get(p.a);
  const b = byCik.get(p.b);
  const tag = fresh.pairs.includes(p) ? 'NEW ' : reviewed.has(pairKey(p.a, p.b)) ? 'OK  ' : '    ';
  console.log(`${tag}pair ${a?.name || p.a} (${p.a}) ${a ? $(a.aum) : ''} / ${b?.name || p.b} (${p.b}) ${b ? $(b.aum) : ''}: ${p.matched} lines, ${(p.shareA * 100).toFixed(1)}% / ${(p.shareB * 100).toFixed(1)}%`);
}
for (const d of fresh.deviations) console.log(`::error::Yeni toplam sapması: #${d.rank} ${d.name} (${d.cik}): bizim ${$(d.aum)}, SEC beyanı ${$(d.declared)} (${d.diffPct > 0 ? '+' : ''}${d.diffPct}%) — ${filingUrl(d.cik, d.acc)}`);
if (fresh.deviations.length) console.log(`::error::Tüm liste: ${reportUrl}`);
// For a new pair, what each side filed for the same quarter: an alternative
// original is suggested, never applied; none means the copy is misfiled.
for (const p of fresh.pairs) {
  const sides = [];
  for (const cik of [p.a, p.b]) {
    const row = byCik.get(cik);
    let filings = [];
    try {
      filings = list13FAll(await getSubmissions(cik));
    } catch {
      /* EDGAR unreachable: the pair is still raised, without advice */
    }
    sides.push({ cik, name: row?.name || cik, acc: row?.acc, reportDate: row?.reportDate, filed: row?.filed, filings });
  }
  const advice = copyAdvice(sides);
  for (let k = 0; k < advice.length; k++) console.log(`    ${adviceLine(advice[k], sides[k].acc, sides[k].filed)}`);
  console.log(`::error::New near-identical books: ${byCik.get(p.a)?.name || p.a} (${p.a}) and ${byCik.get(p.b)?.name || p.b} (${p.b}), ${p.matched} lines. Review; config/misfiled-books.json or config/duplicate-books.json if it is a copy. ${advice.map((a, k) => adviceLine(a, sides[k].acc, sides[k].filed)).join(' ')}`);
}

fs.mkdirSync(file('reports'), { recursive: true });
const report = deviationReport(deviations, { quarter, fresh: fresh.deviations, notes: handNotes, reviewed: handReviewed, auto: autoReviews.filter((a) => !closedByHand.has(kOf(a.cik, a.acc))), lineFixes: lineFixesNow });
fs.writeFileSync(file(reportPath), report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
// the badge on the fund lists and the fund page (api/_lib/fundFlags.js): an
// automatic cover-total closing carries its note like a hand one
const autoNotes = autoReviews.filter((a) => a.kind === 'cover-total' && !closedByHand.has(kOf(a.cik, a.acc)));
const flags = fundFlags({ rows: U.rows, deviations, notes: [...handNotes, ...autoNotes], reviewed: [...handReviewed, ...autoReviews.filter((a) => a.kind === 'small-gap')], quarter });
fs.writeFileSync(file('client/public/fund-flags.json'), `${JSON.stringify({ quarter, ...flags }, null, 1)}\n`);
console.log(`fund-flags.json: ${Object.keys(flags.byCik).length} fund(s) with a badge`);
fs.writeFileSync(
  stateFile,
  `${JSON.stringify({ quarter, deviations: deviations.map((d) => `${d.cik}|${d.acc}`).sort(), pairs: pairs.map((p) => pairKey(p.a, p.b)).sort() }, null, 1)}\n`
);
if (fresh.deviations.length || fresh.pairs.length) process.exit(3);
