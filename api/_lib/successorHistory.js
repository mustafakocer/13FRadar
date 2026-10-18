// A manager whose 13Fs moved to a new filer (Ackman: Pershing Square Capital
// Management → Pershing Square Inc. with the 2026 Q2 report; Einhorn:
// Greenlight → DME) is one book on the site. The registry marks the old
// filer with `successor` (api/_lib/gurus.js). Without this, the new filer's
// first quarter reads as every position bought at once — Ackman's QSR, BN,
// AMZN, UBER … were the top "net buys" of 2026 Q2 — and its history, 1-year
// return and "time held" start from that quarter.
//
// Both filers can report the same quarter (Pershing Square Inc. filed a
// one-position book, HHH, from 2025 Q2 on): such quarters are the sum of
// the two, which is what the manager held (HHH 18,852,064 + 9,000,000 =
// the 27,852,064 of the next report).
//
// Pure: no network, no files.
import { turnover } from './turnover.js';

// The registry's predecessor of a filer, or null.
//   gurus: api/_lib/gurus.js GURUS
export const predecessorOf = (cik, gurus) => gurus.find((g) => g.successor === cik) || null;

// Two holdings snapshots ({ aum, positions: [{ cusip, putCall, shares, value, … }] })
// as one: lines of the same security and put/call are added up.
export function mergeBooks(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const by = new Map();
  for (const p of [...(a.positions || []), ...(b.positions || [])]) {
    const k = `${String(p.cusip || '').toUpperCase()}|${p.putCall || ''}`;
    const q = by.get(k);
    by.set(k, q ? { ...q, shares: (q.shares || 0) + (p.shares || 0), value: (q.value || 0) + (p.value || 0) } : { ...p });
  }
  const aum = (a.aum || 0) + (b.aum || 0);
  const positions = [...by.values()].sort((x, y) => (y.value || 0) - (x.value || 0)).map((p) => ({ ...p, weight: aum ? (p.value / aum) * 100 : 0 }));
  return { ...a, aum, positions };
}

// One guru-history entry (scripts/build-guru-history.mjs) from the
// predecessor's and the successor's own.
//   entry: { name, fp, quarters: [{ reportDate, acc, aum, count, turnover, newCount, exitCount, top10, … }],
//            positions: { cusip: { issuer, ticker, series: [[date, shares, value, weight]], heldQuarters, firstSeen } } }
export function mergeSuccessor(pred, own) {
  if (!pred?.quarters?.length) return own;
  if (!own?.quarters?.length) return { ...pred, name: own?.name || pred.name };
  const qp = new Map(pred.quarters.map((q) => [q.reportDate, q]));
  const qo = new Map(own.quarters.map((q) => [q.reportDate, q]));
  const dates = [...new Set([...qp.keys(), ...qo.keys()])].sort();

  // positions: series added up per date
  const positions = {};
  for (const src of [pred.positions || {}, own.positions || {}]) {
    for (const [cusip, e] of Object.entries(src)) {
      const m = positions[cusip] || { ...e, series: [] };
      const rows = new Map(m.series.map((r) => [r[0], [...r]]));
      for (const r of e.series || []) {
        const x = rows.get(r[0]);
        rows.set(r[0], x ? [r[0], x[1] + r[1], x[2] + r[2], 0] : [...r]);
      }
      m.series = [...rows.values()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
      m.ticker = m.ticker || e.ticker || null;
      positions[cusip] = m;
    }
  }

  const quarters = dates.map((d) => {
    const a = qp.get(d);
    const b = qo.get(d);
    if (!a || !b) return { ...(a || b), source: a ? 'predecessor' : 'own' };
    const main = (a.aum || 0) >= (b.aum || 0) ? a : b;
    return {
      ...main,
      filed: a.filed > b.filed ? a.filed : b.filed,
      alsoAcc: (main === a ? b : a).acc,
      aum: (a.aum || 0) + (b.aum || 0),
      putCallValue: (a.putCallValue || 0) + (b.putCallValue || 0),
      optionLines: (a.optionLines || 0) + (b.optionLines || 0),
      source: 'both',
    };
  });
  const aumOf = new Map(quarters.map((q) => [q.reportDate, q.aum]));
  const idOf = (cusip) => positions[cusip].ticker || cusip;
  // the book of a date, as far as the stored series reach (the build keeps
  // every held position of a concentrated book)
  const book = (d) => {
    const ps = [];
    for (const [cusip, e] of Object.entries(positions)) {
      const r = e.series.find((x) => x[0] === d);
      if (r) ps.push({ cusip, ticker: e.ticker, shares: r[1], value: r[2] });
    }
    return { aum: aumOf.get(d) || 0, positions: ps.sort((x, y) => y.value - x.value) };
  };
  for (const e of Object.values(positions)) for (const r of e.series) r[3] = aumOf.get(r[0]) ? Number(((r[2] / aumOf.get(r[0])) * 100).toFixed(3)) : 0;

  // the quarters whose book changed composition: summed, or the first one of
  // a filer after the other's — their counts and turnover are the merged ones
  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i];
    const p = quarters[i - 1];
    if (q.source !== 'both' && (!p || p.source === q.source)) continue;
    const cur = book(q.reportDate);
    if (q.source === 'both') {
      q.count = cur.positions.length;
      q.top10 = cur.positions.slice(0, 10).map((x) => x.ticker || x.cusip);
    }
    if (!p) continue;
    const t = turnover(book(p.reportDate), cur, { idOf: (x) => idOf(x.cusip) });
    Object.assign(q, { turnover: t.turnover, newCount: t.newCount, exitCount: t.exitCount, turnoverBasis: 'split-adjusted' });
  }

  // time held over the merged quarters, by ticker where known
  const held = new Map();
  for (const [cusip, e] of Object.entries(positions)) {
    const s = held.get(idOf(cusip)) || new Set();
    for (const r of e.series) s.add(r[0]);
    held.set(idOf(cusip), s);
  }
  for (const [cusip, e] of Object.entries(positions)) {
    const have = held.get(idOf(cusip));
    let n = 0;
    for (let i = dates.length - 1; i >= 0 && have.has(dates[i]); i--) n++;
    e.heldQuarters = n;
    e.firstSeen = [...have].sort()[0] || e.series[0]?.[0] || null;
  }
  return { ...own, quarters, positions, predecessor: pred.name };
}

// The stored file's successor entries replaced by the merged ones; the
// successor's own entry kept under `own` so the next build plans its EDGAR
// reads on what the filer itself filed.
export function applySuccessors(file, gurus) {
  const own = { ...(file.own || {}) };
  const out = { ...file, gurus: { ...file.gurus }, own };
  for (const g of gurus) {
    if (!g.successor || !out.gurus[g.cik] || !out.gurus[g.successor]) continue;
    own[g.successor] = own[g.successor] && out.gurus[g.successor].predecessor ? own[g.successor] : out.gurus[g.successor];
    out.gurus[g.successor] = mergeSuccessor(out.gurus[g.cik], own[g.successor]);
  }
  return out;
}
