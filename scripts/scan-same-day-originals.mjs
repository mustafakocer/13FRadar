// Filers that sent two or more original 13F-HRs (not amendments) on the same
// day in one quarter's EDGAR index. For each filing: the period it reports,
// its line count and declared total, whether the universe uses it, and
// whether its table is 90%+ another filer's book (a filing agent's slip, as
// Kingsbury's 0001104659-26-100644 carried KMT Wealth's table).
// Prints a markdown table (and appends it to the step summary). Writes nothing.
//
//   SCAN_QUARTER=2026Q3 node scripts/scan-same-day-originals.mjs
import fs from 'node:fs';
import { secGet, fetchInfoTableXml, fetchCoverPage, parse13F } from '../api/_lib/sec.js';
import { lineKey } from '../api/_lib/universeAudit.js';

const [y, q] = String(process.env.SCAN_QUARTER || '2026Q3').split('Q').map(Number);
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const universe = read('client/public/universe.json');
const holdings = read('api/_data/latest-holdings.json').byCik;
const pad = (c) => String(c).padStart(10, '0');
const chosen = new Map(universe.rows.map((r) => [r.cik, r]));
const $m = (v) => (v == null ? '—' : `$${(v / 1e6).toFixed(1)}M`);

const idx = String((await secGet(`https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/master.idx`, { responseType: 'text', transformResponse: [(d) => d] })).data);
const groups = new Map();
for (const line of idx.split('\n')) {
  const p = line.split('|').map((s) => s.trim());
  if (p.length !== 5 || p[2] !== '13F-HR') continue;
  const acc = /(\d{10}-\d{2}-\d{6})/.exec(p[4])?.[1];
  if (!acc) continue;
  const k = `${pad(p[0])}|${p[3]}`;
  if (!groups.has(k)) groups.set(k, { cik: pad(p[0]), name: p[1], filed: p[3], accs: [] });
  groups.get(k).accs.push(acc);
}
const cases = [...groups.values()].filter((g) => g.accs.length >= 2);
console.log(`${y}Q${q}: ${cases.length} filer-day(s) with two or more original 13F-HRs`);

// candidate copies: another filer whose top-10 lines are mostly in this table
const topKeys = Object.entries(holdings).map(([cik, h]) => ({ cik, acc: h.acc, keys: (h.top || []).map(lineKey) }));
async function linesOf(cik, acc) {
  const rows = await parse13F(await fetchInfoTableXml(cik, acc));
  return rows.map((r) => lineKey({ cusip: r.cusip, putCall: r.putCall, shares: Number(r.shrsOrPrnAmt?.sshPrnamt) || 0 }));
}
function overlap(a, b) {
  const B = new Map();
  for (const k of b) B.set(k, (B.get(k) || 0) + 1);
  let n = 0;
  for (const k of a) if (B.get(k) > 0) { n++; B.set(k, B.get(k) - 1); }
  return n;
}
async function copyOf(cik, lines) {
  const set = new Set(lines);
  const cands = topKeys
    .filter((t) => t.cik !== cik && t.keys.length >= 5 && t.keys.filter((k) => set.has(k)).length >= Math.min(7, t.keys.length))
    .slice(0, 3);
  for (const c of cands) {
    try {
      const other = await linesOf(c.cik, c.acc);
      const n = overlap(lines, other);
      if (n / lines.length >= 0.9 && n / other.length >= 0.9) return { cik: c.cik, name: chosen.get(c.cik)?.name || c.cik, acc: c.acc, share: n / lines.length };
    } catch {
      /* unreadable candidate */
    }
  }
  return null;
}

const out = ['| Fon (CIK) | Gün | Bildirim | Dönem | Satır | Beyan edilen toplam | Bizim seçimimiz | Başka fonla %90+ örtüşme |', '|---|---|---|---|---:|---:|---|---|'];
for (const g of cases.sort((a, b) => a.name.localeCompare(b.name))) {
  for (const acc of g.accs.sort()) {
    let cover = null;
    let lines = [];
    try {
      cover = await fetchCoverPage(g.cik, acc);
      lines = await linesOf(g.cik, acc);
    } catch (e) {
      console.log(`  ${g.cik} ${acc}: unreadable (${e.message})`);
    }
    const copy = lines.length >= 10 ? await copyOf(g.cik, lines) : null;
    const used = chosen.get(g.cik)?.acc === acc ? '**seçili**' : '';
    out.push(`| ${g.name} (${g.cik}) | ${g.filed} | ${acc} | ${cover?.periodOfReport || '—'} | ${lines.length || cover?.tableEntryTotal || '—'} | ${$m(cover?.tableValueTotal)} | ${used} | ${copy ? `${copy.name} (${copy.cik}) %${Math.round(copy.share * 100)}` : '—'} |`);
  }
}
const md = out.join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Same-day originals ${y}Q${q}\n\n${md}\n`);
