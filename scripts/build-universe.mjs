// Builds client/public/universe.json by scanning ALL 13F-HR filers in the
// last two EDGAR quarterly indexes and computing AUM / position count /
// top-10 concentration for each filer's latest filing.
//
//   node scripts/build-universe.mjs
//
// Env: SEC_USER_AGENT (recommended), UNIVERSE_LIMIT (0 = all filers)
// Respects SEC's rate guidance (~6 req/s with pacing below).
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { fetchInfoTableXml, parse13F, aggregatePositions } from '../api/_lib/sec.js';
import { mapCusipsToTickers } from '../api/_lib/figi.js';
import { dominantPeriod, rotateSnapshot, withDeltas } from '../api/_lib/stocksSnapshot.js';
import { accumulateFiler, finalizeAgg, sicToSector, latestPublicFloat, floatBand } from '../api/_lib/universeAgg.js';
import { tickerMap } from '../api/_lib/tickers.js';
import { getSubmissions } from '../api/_lib/sec.js';

const UA = process.env.SEC_USER_AGENT || '13FRadar-universe/1.0 (kocergpt@gmail.com)';
const LIMIT = Number(process.env.UNIVERSE_LIMIT || 0);
// UNIVERSE_DIFF=0 skips each filer's PRIOR quarter filing (default on: the
// stock screener needs adding/reducing counts and net flow; doubles EDGAR requests).
const DIFF = process.env.UNIVERSE_DIFF !== '0';
const ENRICH = Number(process.env.UNIVERSE_ENRICH || 2000); // stocks to enrich with SIC sector + public float
const http = axios.create({ timeout: 60000, headers: { 'User-Agent': UA } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function quarterOf(d) {
  return { y: d.getUTCFullYear(), q: Math.floor(d.getUTCMonth() / 3) + 1 };
}
function prevQuarter({ y, q }) {
  return q === 1 ? { y: y - 1, q: 4 } : { y, q: q - 1 };
}

async function masterIdx({ y, q }) {
  const url = `https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/master.idx`;
  const { data } = await http.get(url, { responseType: 'text', transformResponse: [(d) => d] });
  return data;
}

async function main() {
  const cur = quarterOf(new Date());
  const quarters = [prevQuarter(cur), cur]; // older first so newer wins
  const latestByCik = new Map();

  for (const qt of quarters) {
    let idx;
    try {
      idx = await masterIdx(qt);
    } catch {
      continue; // quarter index may not exist yet
    }
    for (const line of idx.split('\n')) {
      // CIK|Company Name|Form Type|Date Filed|Filename
      const parts = line.split('|');
      if (parts.length !== 5) continue;
      const [cik, name, form, filed, file] = parts.map((s) => s.trim());
      if (form !== '13F-HR' && form !== '13F-HR/A') continue;
      const acc = /(\d{10}-\d{2}-\d{6})/.exec(file)?.[1];
      if (!acc) continue;
      const existing = latestByCik.get(cik);
      if (!existing) latestByCik.set(cik, { cik, name, filed, acc, prevAcc: null, prevFiled: null });
      else if (existing.filed <= filed) latestByCik.set(cik, { cik, name, filed, acc, prevAcc: existing.acc, prevFiled: existing.filed });
      else if (!existing.prevAcc || existing.prevFiled < filed) Object.assign(existing, { prevAcc: acc, prevFiled: filed });
    }
  }

  let entries = [...latestByCik.values()];
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);
  console.log(`Filers to process: ${entries.length}`);

  const rows = [];
  const stockAgg = new Map(); // cusip -> per-stock aggregate (see universeAgg.js)
  let done = 0;
  let failed = 0;
  const CONCURRENCY = 3;
  let i = 0;

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < entries.length) {
        const e = entries[i++];
        try {
          const xml = await fetchInfoTableXml(e.cik, e.acc);
          const parsed = await parse13F(xml);
          const { aum, positions } = aggregatePositions(parsed, e.filed);
          const top10 = positions.slice(0, 10).reduce((s, p) => s + p.weight, 0);
          rows.push({
            cik: e.cik.padStart(10, '0'),
            name: e.name,
            filed: e.filed,
            aum: Math.round(aum),
            positions: positions.length,
            top10: Number(top10.toFixed(1)),
          });
          // universe-wide per-stock aggregate; the prior filing gives adding/reducing
          let prevPositions = null;
          if (DIFF && e.prevAcc && e.prevAcc !== e.acc) {
            try {
              const px = await parse13F(await fetchInfoTableXml(e.cik, e.prevAcc));
              prevPositions = aggregatePositions(px, e.prevFiled).positions;
              await sleep(350);
            } catch {
              prevPositions = null;
            }
          }
          accumulateFiler(stockAgg, positions, prevPositions);
        } catch {
          failed++;
        }
        done++;
        if (done % 200 === 0) console.log(`  ${done}/${entries.length} (failed: ${failed})`);
        await sleep(350); // ~2.8 req/s per worker x2 requests -> stays under SEC limits
      }
    })
  );

  rows.sort((a, b) => b.aum - a.aum);
  const pub = path.join(process.cwd(), 'client', 'public');
  fs.mkdirSync(pub, { recursive: true });
  fs.writeFileSync(
    path.join(pub, 'universe.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), count: rows.length, rows })
  );
  console.log(`Wrote ${rows.length} managers -> universe.json (failed: ${failed})`);

  // Rank all securities by total universe value
  const ranked = finalizeAgg(stockAgg);

  // Big static CUSIP->ticker map (top 6000): makes holdings endpoints resolve
  // tickers instantly at runtime instead of hitting OpenFIGI per request.
  console.log('Resolving tickers via OpenFIGI (top 6000)…');
  let tickers = {};
  try {
    tickers = await mapCusipsToTickers(
      ranked.slice(0, 6000).map((s) => s.cusip),
      { maxLive: 6000 }
    );
  } catch (e) {
    console.warn('FIGI mapping failed:', e.message);
  }
  const map = {};
  let mapped = 0;
  for (const [c, t] of Object.entries(tickers)) {
    if (t) {
      map[c] = t;
      mapped++;
    }
  }
  const dataDir = path.join(process.cwd(), 'api', '_data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'cusip-tickers.json'), JSON.stringify(map));
  console.log(`Wrote ${mapped} mappings -> api/_data/cusip-tickers.json`);

  // Quarter-over-quarter: keep the previous period's file so the stock
  // watchlist / screener can show the change in fund count and value.
  const readJson = (f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(pub, f), 'utf8'));
    } catch {
      return null;
    }
  };
  const period = dominantPeriod(rows.map((r) => r.filed));
  const { prev, rotated } = rotateSnapshot(readJson('stocks.json'), readJson('stocks-prev.json'), period);
  if (prev) fs.writeFileSync(path.join(pub, 'stocks-prev.json'), JSON.stringify(prev));
  const topStocks = withDeltas(ranked.slice(0, 2000), prev);

  // Sector (SIC bucket) and size (SEC public float) for the screener — both
  // from EDGAR, refreshed weekly. Needs ticker -> issuer CIK (company_tickers).
  console.log(`Enriching ${Math.min(ENRICH, topStocks.length)} stocks with SIC sector + public float…`);
  let tmap = new Map();
  try {
    tmap = await tickerMap();
  } catch (e) {
    console.warn('company_tickers unavailable:', e.message);
  }
  let enriched = 0;
  for (const s of topStocks.slice(0, ENRICH)) {
    const tk = tickers[s.cusip];
    const icik = tk ? tmap.get(tk) || tmap.get(tk.replace('-', '')) : null;
    if (!icik) continue;
    try {
      const sub = await getSubmissions(icik);
      s.sic = sub.sic ? Number(sub.sic) : null;
      s.sector = sicToSector(s.sic);
      s.issuerCik = String(icik);
      await sleep(200);
      const { data: concept } = await http.get(`https://data.sec.gov/api/xbrl/companyconcept/CIK${String(icik).padStart(10, '0')}/dei/EntityPublicFloat.json`, { validateStatus: () => true });
      const f = latestPublicFloat(concept);
      s.float = f?.value ?? null;
      s.floatAsOf = f?.asOf ?? null;
      s.size = floatBand(s.float);
      enriched++;
      await sleep(200);
    } catch {
      /* enrichment optional */
    }
  }
  console.log(`enriched ${enriched}`);
  fs.writeFileSync(
    path.join(pub, 'stocks.json'),
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      period,
      prevPeriod: prev?.period || null,
      diff: DIFF,
      rows: topStocks.map((s) => ({ ...s, ticker: tickers[s.cusip] ?? null })),
    })
  );
  console.log(`Wrote ${topStocks.length} stocks -> stocks.json (period ${period}${rotated ? ', rotated prev snapshot' : ''})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
