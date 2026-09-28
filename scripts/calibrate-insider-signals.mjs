// Do the signal levels mean anything? For every open-market buy filing in
// the dataset, the stock's return over the next 30 and 90 days minus SPY's,
// grouped by level (Güçlü / Orta / Zayıf / Sinyal yok).
//
//   node scripts/calibrate-insider-signals.mjs            markdown table
//   node scripts/calibrate-insider-signals.mjs --json     machine-readable
//
// One observation per FILING (a buy split into price lots is one decision),
// rated on the filing's total (insiderSignal.filingTotals). The outcome is the
// `x30` / `x90` the nightly build stored, else computed here from the price
// cache (api/_data/prices). Buys whose horizon has not passed, or whose
// ticker has no price history, are left out and counted as such.
//
// This checks that the labels are consistent — Güçlü above Orta above Zayıf
// on the data we have. It is not investment advice and not a backtest of a
// strategy: no costs, no timing, one-year sample, survivorship in the price
// cache (it holds the stocks the tracked funds own).
import { currentRows, readServed } from '../api/_lib/insiderStore.js';
import { classify } from '../api/_lib/insiderClassify.js';
import { filingTotals, signalLevel, LEVELS } from '../api/_lib/insiderSignal.js';
import { forwardExcess } from '../api/_lib/insiderOutcome.js';
import { readSeries } from '../api/_lib/priceStore.js';
import { SIGNAL } from '../api/_lib/insiderSignalConfig.js';

const JSON_OUT = process.argv.includes('--json');
const rows = currentRows(readServed().rows);
const spy = readSeries('SPY')?.prices || [];
if (!spy.length) {
  console.error('No SPY series in api/_data/prices — nothing to compare against.');
  process.exit(1);
}

const totals = filingTotals(rows);
const firstLine = new Map();
for (const r of rows) {
  if (classify(r).category !== 'open_buy') continue;
  const cur = firstLine.get(r.a);
  if (!cur || r.d < cur.d) firstLine.set(r.a, r);
}

const seriesMemo = new Map();
const series = (t) => {
  if (!seriesMemo.has(t)) seriesMemo.set(t, readSeries(t)?.prices || null);
  return seriesMemo.get(t);
};

const buckets = Object.fromEntries(LEVELS.map((l) => [l, { filings: 0, ...Object.fromEntries(SIGNAL.horizons.map((h) => [h, []])) }]));
let noSeries = 0;
for (const [acc, r] of firstLine) {
  const level = signalLevel(r, { filing: totals.get(acc) }).level;
  const b = buckets[level];
  b.filings++;
  const s = r.t ? series(r.t) : null;
  if (!s && SIGNAL.horizons.every((h) => r[`x${h}`] == null)) noSeries++;
  for (const h of SIGNAL.horizons) {
    const x = r[`x${h}`] ?? (s ? forwardExcess(s, spy, r.d, h) : null);
    if (x != null) b[h].push(x);
  }
}

const stats = (xs) => {
  if (!xs.length) return { n: 0, mean: null, median: null, positive: null };
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    n: xs.length,
    mean: Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)),
    median: Number(median.toFixed(1)),
    positive: Number(((xs.filter((x) => x > 0).length / xs.length) * 100).toFixed(0)),
  };
};

const order = ['strong', 'medium', 'weak', 'none'];
const table = order.map((l) => ({ level: l, filings: buckets[l].filings, ...Object.fromEntries(SIGNAL.horizons.map((h) => [h, stats(buckets[l][h])])) }));

// Is the ladder monotonic? Compare medians where both sides have a sample.
const ladder = {};
for (const h of SIGNAL.horizons) {
  const med = (l) => table.find((t) => t.level === l)[h];
  const pairs = [['strong', 'medium'], ['medium', 'weak']];
  ladder[h] = pairs.map(([a, b]) => ({
    pair: `${a} > ${b}`,
    holds: med(a).n >= 10 && med(b).n >= 10 ? med(a).median > med(b).median : null,
  }));
}

if (JSON_OUT) {
  console.log(JSON.stringify({ filings: firstLine.size, noSeries, table, ladder }, null, 1));
} else {
  const TR = { strong: 'Güçlü', medium: 'Orta', weak: 'Zayıf', none: 'Sinyal yok' };
  const f = (v, suffix = '') => (v == null ? '—' : `${v > 0 && suffix === ' pp' ? '+' : ''}${v}${suffix}`);
  console.log(`Open-market buy filings: ${firstLine.size}; without any price history: ${noSeries}\n`);
  console.log(`| Seviye | Dosyalama | 30g n | 30g ort. | 30g medyan | 30g >0 | 90g n | 90g ort. | 90g medyan | 90g >0 |`);
  console.log(`|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|`);
  for (const t of table) {
    const a = t[30];
    const b = t[90];
    console.log(`| ${TR[t.level]} | ${t.filings} | ${a.n} | ${f(a.mean, ' pp')} | ${f(a.median, ' pp')} | ${f(a.positive, '%')} | ${b.n} | ${f(b.mean, ' pp')} | ${f(b.median, ' pp')} | ${f(b.positive, '%')} |`);
  }
  console.log('\npp = SPY\'ye göre yüzde puan fark. Sıralama (medyan, n ≥ 10):');
  for (const h of SIGNAL.horizons) console.log(`  ${h}g: ${ladder[h].map((x) => `${x.pair}: ${x.holds == null ? 'örnek yetersiz' : x.holds ? 'tutuyor' : 'TUTMUYOR'}`).join(' · ')}`);
}
