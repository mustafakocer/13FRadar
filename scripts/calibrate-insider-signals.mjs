// Do the signal levels mean anything? For every open-market buy filing in
// the dataset, the stock's return over the next 30 and 90 days minus SPY's,
// grouped by level (Güçlü / Orta / Zayıf / Sinyal yok).
//
//   node scripts/calibrate-insider-signals.mjs            markdown table
//   node scripts/calibrate-insider-signals.mjs --json     machine-readable
//   node scripts/calibrate-insider-signals.mjs --out docs/calibration/insider-signals
//        also write <dir>/<YYYY-MM>.md and .json (the monthly workflow does;
//        the site never shows these — they are for re-deciding the levels
//        once two years of data exist)
//   node scripts/calibrate-insider-signals.mjs --fetch    also download daily
//        closes (Yahoo chart, ~400 days) for tickers the price cache lacks —
//        what the nightly build does; needs the network of a GitHub runner
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
import { forwardExcess, priceMismatch } from '../api/_lib/insiderOutcome.js';
import { readSeries } from '../api/_lib/priceStore.js';
import { SIGNAL } from '../api/_lib/insiderSignalConfig.js';
import { fetchCharts } from '../api/_lib/marketData.js';
import fs from 'node:fs';
import path from 'node:path';

const JSON_OUT = process.argv.includes('--json');
const FETCH = process.argv.includes('--fetch');
const OUT_DIR = (() => {
  const i = process.argv.indexOf('--out');
  return i > -1 ? process.argv[i + 1] : null;
})();
const SMALL_SAMPLE = 100; // below this, a level's median is flagged as possibly chance
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
if (FETCH) {
  const need = [...new Set([...firstLine.values()].map((r) => r.t).filter((t) => t && !readSeries(t)))];
  console.error(`fetching daily closes for ${need.length} ticker(s) without a cached series…`);
  const { snapshots, failed } = await fetchCharts(need, { onProgress: (d, n) => console.error(`  ${d}/${n}`) });
  for (const [t, snap] of snapshots) if (snap?.closes?.length) seriesMemo.set(t, snap.closes);
  console.error(`  ${[...snapshots.values()].filter((s) => s?.closes?.length).length} fetched, ${failed} failed`);
}
const series = (t) => {
  if (!seriesMemo.has(t)) seriesMemo.set(t, readSeries(t)?.prices || null);
  return seriesMemo.get(t);
};

const buckets = Object.fromEntries(LEVELS.map((l) => [l, { filings: 0, ...Object.fromEntries(SIGNAL.horizons.map((h) => [h, []])), dates: Object.fromEntries(SIGNAL.horizons.map((h) => [h, []])) }]));
let noSeries = 0;
for (const [acc, r] of firstLine) {
  const level = signalLevel(r, { filing: totals.get(acc) }).level;
  const b = buckets[level];
  b.filings++;
  const s = r.t ? series(r.t) : null;
  if (!s && SIGNAL.horizons.every((h) => r[`x${h}`] == null)) noSeries++;
  for (const h of SIGNAL.horizons) {
    const x = r[`x${h}`] ?? (s ? forwardExcess(s, spy, r.d, h) : null);
    if (x != null) {
      b[h].push(x);
      b.dates[h].push(r.d);
    }
  }
}

// Mean, median, share above zero, and a distribution-free 95% interval for
// the median (order statistics n/2 ± 1.96·√n/2) — no assumption that
// returns are normal, which they are not.
const stats = (xs, dates = []) => {
  if (!xs.length) return { n: 0, mean: null, median: null, positive: null, ci: null, from: null, to: null };
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const half = (1.96 * Math.sqrt(n)) / 2;
  const lo = sorted[Math.max(0, Math.floor(n / 2 - half) - 1)];
  const hi = sorted[Math.min(n - 1, Math.ceil(n / 2 + half) - 1)];
  const ds = [...dates].sort();
  return {
    n,
    mean: Number((xs.reduce((a, b) => a + b, 0) / n).toFixed(1)),
    median: Number(median.toFixed(1)),
    positive: Number(((xs.filter((x) => x > 0).length / n) * 100).toFixed(0)),
    ci: [Number(lo.toFixed(1)), Number(hi.toFixed(1))],
    from: ds[0] || null,
    to: ds[ds.length - 1] || null,
    small: n < SMALL_SAMPLE,
  };
};

const order = ['strong', 'medium', 'weak', 'none'];
const table = order.map((l) => ({ level: l, filings: buckets[l].filings, ...Object.fromEntries(SIGNAL.horizons.map((h) => [h, stats(buckets[l][h], buckets[l].dates[h])])) }));

// Is the ladder monotonic? Medians, where both sides have a sample; and
// whether the two 95% intervals overlap (then the order may be chance).
const ladder = {};
for (const h of SIGNAL.horizons) {
  const at = (l) => table.find((t) => t.level === l)[h];
  ladder[h] = [['strong', 'medium'], ['medium', 'weak']].map(([a, b]) => {
    const A = at(a);
    const B = at(b);
    const ok = A.n >= 10 && B.n >= 10;
    return {
      pair: `${a} > ${b}`,
      holds: ok ? A.median > B.median : null,
      overlap: ok ? A.ci[0] <= B.ci[1] && B.ci[0] <= A.ci[1] : null,
    };
  });
}

const TR = { strong: 'Öne çıkan alım', medium: 'Kayda değer alım', weak: 'Küçük alım', none: 'Etiketsiz' };
const pp = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}`);
function markdown() {
  const out = [];
  out.push(`Açık piyasa alımı dosyalaması: ${firstLine.size}; fiyat geçmişi olmayan: ${noSeries}`);
  out.push('');
  out.push('| Seviye | Dosyalama | Süre | n | Tarih aralığı | Ort. (pp) | Medyan (pp) | Medyan %95 aralığı | SPY\'yi geçen | Not |');
  out.push('|---|---:|---|---:|---|---:|---:|---|---:|---|');
  for (const t of table) {
    for (const h of SIGNAL.horizons) {
      const x = t[h];
      const note = !x.n ? 'veri yok' : x.small ? 'örnek az, sonuç rastlantı olabilir' : '';
      out.push(`| ${TR[t.level]} | ${t.filings} | ${h}g | ${x.n} | ${x.from ? `${x.from} → ${x.to}` : '—'} | ${pp(x.mean)} | ${pp(x.median)} | ${x.ci ? `${pp(x.ci[0])} … ${pp(x.ci[1])}` : '—'} | ${x.positive == null ? '—' : `%${x.positive}`} | ${note} |`);
    }
  }
  out.push('');
  out.push('pp = hissenin getirisi eksi aynı günlerde SPY getirisi (yüzde puan). Bir gözlem = bir dosyalama (parçalı alımlar tek sayılır); başlangıç, işlem gününün kapanışı.');
  out.push('');
  out.push('Sıralama (medyana göre; aralıklar çakışıyorsa fark rastlantı olabilir):');
  for (const h of SIGNAL.horizons)
    out.push(`- ${h} gün: ${ladder[h].map((x) => `${x.pair}: ${x.holds == null ? 'örnek yetersiz' : x.holds ? 'tutuyor' : 'TUTMUYOR'}${x.overlap ? ' (aralıklar çakışıyor)' : ''}`).join(' · ')}`);
  out.push('');
  out.push(`Fiyat birimi kontrolü: kapanışı bilinen ${mismatch.checked} açık piyasa satırının ${mismatch.lines}'i (${Object.keys(mismatch.byTicker).length} hisse) işlem günü kapanışından %25'ten fazla sapıyor. İlk 20 (satır sayısına göre; oran = form fiyatı / kapanış):`);
  out.push('');
  out.push('| Hisse | Satır | Medyan oran |');
  out.push('|---|---:|---:|');
  for (const m of topMismatch) out.push(`| ${m.ticker} | ${m.lines} | ${m.medianRatio} |`);
  out.push('');
  out.push('Bu bir yatırım tavsiyesi değil; etiketlerin tutarlılık kontrolüdür. Maliyet ve zamanlama yok; fiyat verisi Yahoo günlük kapanışları ve fiyat önbelleği.');
  return out.join('\n');
}

// Price unit check (input to roadmap item 4): open-market lines whose form
// price is more than 25% away from that day's close — a foreign currency or
// a per-ADR/per-share mix-up. The nightly build flags these (`pu`).
const mismatch = { lines: 0, checked: 0, byTicker: {} };
for (const r of rows) {
  const cat = classify(r).category;
  if (!r.t || (cat !== 'open_buy' && cat !== 'open_sell')) continue;
  const m = priceMismatch(r, series(r.t));
  if (m == null) continue;
  mismatch.checked++;
  if (!m) continue;
  mismatch.lines++;
  const e = (mismatch.byTicker[r.t] ||= { lines: 0, ratios: [] });
  e.lines++;
  e.ratios.push(m.ratio);
}
const topMismatch = Object.entries(mismatch.byTicker)
  .sort((a, b) => b[1].lines - a[1].lines)
  .slice(0, 20)
  .map(([t, e]) => ({ ticker: t, lines: e.lines, medianRatio: [...e.ratios].sort((a, b) => a - b)[e.ratios.length >> 1] }));

const result = { generatedAt: new Date().toISOString(), filings: firstLine.size, noSeries, config: SIGNAL, table, ladder, priceUnits: { checked: mismatch.checked, flagged: mismatch.lines, tickers: Object.keys(mismatch.byTicker).length, top: topMismatch } };
if (JSON_OUT) console.log(JSON.stringify(result, null, 1));
else console.log(markdown());

if (OUT_DIR) {
  const stamp = result.generatedAt.slice(0, 7);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${stamp}.json`), JSON.stringify(result, null, 1));
  fs.writeFileSync(path.join(OUT_DIR, `${stamp}.md`), `# Insider seviye kalibrasyonu — ${stamp}\n\n${markdown()}\n`);
  console.error(`written ${OUT_DIR}/${stamp}.md and .json`);
}
