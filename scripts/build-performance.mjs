// Fund performance score (P1-7). Weekly, after the universe build.
//
//   node scripts/build-performance.mjs
//
// Fund set: popular + consensus managers + the largest filers by AUM from
// universe.json (PERF_TOP_AUM, default 60), capped at PERF_MAX_FUNDS (80).
// For each fund the last 13 filings are loaded (12 quarters of returns +
// baseline); the top 50 positions per quarter are priced.
// Prices: daily regular closes via api/_lib/providers.dailyCloses
// (FMP -> Twelve Data -> Stooq, whichever keys are configured). Benchmark SPY.
// Output: client/public/performance.json
import fs from 'node:fs';
import path from 'node:path';
import { getSubmissions, list13F, getFilingHoldings } from '../api/_lib/sec.js';
import { mapCusipsToTickers } from '../api/_lib/figi.js';
import { mapLimit } from '../api/_lib/yahooClient.js';
import { dailyCloses } from '../api/_lib/providers.js';
import { quarterlySeries, compound, priceAt, scoreFund } from '../api/_lib/performance.js';
import { quarterTrades } from '../api/_handlers/manager-stats.js';
import { CONSENSUS_MANAGERS } from '../api/_lib/consensusList.js';
import { POPULAR_MANAGERS } from '../client/src/data/popular.js';

const QUARTERS = 13;
const TOP = 50;
const TOP_AUM = Number(process.env.PERF_TOP_AUM || 60);
const MAX_FUNDS = Number(process.env.PERF_MAX_FUNDS || 80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pub = path.join(process.cwd(), 'client', 'public');

async function main() {
  const set = new Map();
  for (const m of [...POPULAR_MANAGERS, ...CONSENSUS_MANAGERS]) set.set(m.cik.padStart(10, '0'), m.name);
  try {
    const u = JSON.parse(fs.readFileSync(path.join(pub, 'universe.json'), 'utf8'));
    for (const r of u.rows.slice(0, TOP_AUM)) if (!set.has(r.cik)) set.set(r.cik, r.name);
  } catch {}
  const ciks = [...set.keys()].slice(0, MAX_FUNDS);
  console.log(`funds: ${ciks.length}`);

  // 1. holdings
  const funds = (
    await mapLimit(ciks, 3, async (cik) => {
      try {
        const sub = await getSubmissions(cik);
        const fl = list13F(sub).slice(0, QUARTERS).reverse();
        if (fl.length < 2) return null;
        const snaps = [];
        for (const f of fl) {
          const h = await getFilingHoldings(cik, f);
          snaps.push({ reportDate: f.reportDate, filingDate: f.filingDate, aum: h.aum, all: h.positions, positions: h.positions.filter((p) => !p.putCall).sort((a, b) => b.value - a.value).slice(0, TOP) });
          await sleep(150);
        }
        return { cik, name: sub.name || set.get(cik), snaps };
      } catch (e) {
        console.warn(`skip ${cik}: ${e.message}`);
        return null;
      }
    })
  ).filter(Boolean);

  // 2. tickers
  const cusips = new Set();
  for (const f of funds) for (const s of f.snaps) for (const p of s.positions) cusips.add(p.cusip);
  const tickers = await mapCusipsToTickers([...cusips], { maxLive: 2000 }).catch(() => ({}));
  for (const f of funds) for (const s of f.snaps) for (const p of s.positions) p.ticker = tickers[p.cusip] || null;

  // 3. prices
  const symbols = new Set(['SPY']);
  for (const f of funds) for (const s of f.snaps) for (const p of s.positions) if (p.ticker) symbols.add(p.ticker);
  console.log(`pricing ${symbols.size} symbols…`);
  const series = new Map();
  let priced = 0;
  await mapLimit([...symbols], 4, async (sym) => {
    try {
      series.set(sym, await dailyCloses(sym));
      priced++;
    } catch {}
    await sleep(250);
  });
  console.log(`priced ${priced}/${symbols.size}`);
  const px = (sym, date) => priceAt(series.get(sym), date);

  // 4. metrics
  const rows = funds.map((f) => {
    const q = quarterlySeries(f.snaps, px, { mode: 'quarterEnd', top: TOP, endDate: new Date().toISOString().slice(0, 10), benchmark: 'SPY' });
    const latest = f.snaps[f.snaps.length - 1];
    const yearAgo = f.snaps.find((s) => s.reportDate <= addYears(latest.reportDate, -1) && s.reportDate > addYears(latest.reportDate, -1.3));
    const eqMap = (s) => ({ reportDate: s.reportDate, aum: s.aum, byCusip: new Map(s.all.filter((p) => !p.putCall).map((p) => [p.cusip, p])) });
    const acts = [];
    for (let i = 1; i < f.snaps.length; i++) {
      const t = quarterTrades(eqMap(f.snaps[i - 1]), eqMap(f.snaps[i]));
      if (t.activity != null) acts.push(t.activity);
    }
    const spy = (n) => compound(q.map((x) => ({ ret: x.bench })), n);
    return {
      cik: f.cik,
      name: f.name,
      reportDate: latest.reportDate,
      aum: latest.aum,
      positions: latest.all.filter((p) => !p.putCall).length,
      top10: latest.positions.slice(0, 10).reduce((s, p) => s + p.weight, 0),
      turnover: acts.length ? acts.slice(-4).reduce((s, x) => s + x, 0) / Math.min(4, acts.length) : null,
      aumTrend1y: yearAgo?.aum ? latest.aum / yearAgo.aum - 1 : null,
      retQ: q.length ? q[q.length - 1].ret : null,
      ret1y: compound(q, 4),
      ret3y: compound(q, 12),
      spy1y: spy(4),
      spy3y: spy(12),
      coverage: q.length ? q.slice(-4).reduce((s, x) => s + x.coverage, 0) / Math.min(4, q.length) : 0,
      quarters: q.map((x) => ({ reportDate: x.reportDate, ret: x.ret, bench: x.bench, coverage: x.coverage })),
    };
  });
  for (const r of rows) r.score = scoreFund(r, rows);
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.ret1y ?? -9) - (a.ret1y ?? -9));

  fs.writeFileSync(path.join(pub, 'performance.json'), JSON.stringify({ updatedAt: new Date().toISOString(), priceSource: process.env.FMP_API_KEY ? 'FMP' : process.env.TWELVEDATA_API_KEY ? 'Twelve Data' : 'Stooq', benchmark: 'SPY', quarters: QUARTERS - 1, topPositions: TOP, funds: rows }));
  console.log(`performance.json: ${rows.length} funds`);
}

function addYears(date, y) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + Math.round(y * 12));
  return d.toISOString().slice(0, 10);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
