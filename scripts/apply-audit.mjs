// Apply the unit slips a universe audit found (scripts/audit-universe.mjs
// SLIP lines) to the stored copies, without EDGAR:
//
//   node scripts/apply-audit.mjs <audit log>
//
// A SLIP line says the stored total of a filing is exactly ×1000 (or ÷1000)
// off a fresh read of its full table — the unit check on the stored top
// lines had too few priced rows to decide (Betterment's top ten are ETFs
// with no price series; CMT's are options). The filing is rescaled as a
// whole in universe.json and latest-holdings.json and marked `unitFix` (by
// 'audit-full-table'), so repair-units.mjs leaves it alone and lists it in
// unit-corrections.json. A line whose accession no longer matches the
// stored one (a newer filing since the audit) is skipped.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const file = (...p) => path.join(root, ...p);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function parseSlips(text) {
  const out = [];
  for (const m of String(text).matchAll(/\bSLIP (\d{10}) (\S+) (\d+) (\d+) (1000|0\.001)\b/g)) out.push({ cik: m[1], acc: m[2], stored: Number(m[3]), fresh: Number(m[4]), factor: Number(m[5]) });
  return out;
}

export function applySlips(slips, U, L) {
  const rows = new Map(U.rows.map((r) => [r.cik, r]));
  const applied = [];
  const skipped = [];
  for (const s of slips) {
    const r = rows.get(s.cik);
    const e = L.byCik?.[s.cik];
    if (!r || r.acc !== s.acc || r.aum !== s.stored || e?.unitFix) {
      skipped.push({ ...s, why: !r ? 'not in the universe' : r.acc !== s.acc ? 'newer filing' : e?.unitFix ? 'already rescaled' : 'stored total changed' });
      continue;
    }
    r.aum = Math.round(r.aum * s.factor);
    if (Number.isFinite(r.putCallValue)) r.putCallValue = Math.round(r.putCallValue * s.factor);
    if (e && e.acc === s.acc) {
      e.aum = Math.round(e.aum * s.factor);
      for (const p of e.top || []) p.value = Math.round(p.value * s.factor);
      e.unitFix = { factor: s.factor, by: 'audit-full-table' };
    }
    applied.push(s);
  }
  return { applied, skipped };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const log = process.argv[2];
  if (!log) {
    console.error('usage: node scripts/apply-audit.mjs <audit log>');
    process.exit(2);
  }
  const U = readJson(file('client/public/universe.json'));
  const L = readJson(file('api/_data/latest-holdings.json'));
  const { applied, skipped } = applySlips(parseSlips(fs.readFileSync(log, 'utf8')), U, L);
  U.rows.sort((a, b) => b.aum - a.aum);
  fs.writeFileSync(file('client/public/universe.json'), JSON.stringify(U));
  fs.writeFileSync(file('api/_data/latest-holdings.json'), JSON.stringify(L));
  console.log(`rescaled ${applied.length} filings (+$${(applied.reduce((s, x) => s + x.fresh - x.stored, 0) / 1e9).toFixed(2)}B); skipped ${skipped.length}`);
  for (const s of skipped) console.log(`  skipped ${s.cik} ${s.acc}: ${s.why}`);
  console.log('now run: node scripts/repair-units.mjs (summary and correction log)');
}
