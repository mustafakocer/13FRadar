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

const UA = process.env.SEC_USER_AGENT || 'Fundocap-universe/1.0 (kocergpt@gmail.com)';
const LIMIT = Number(process.env.UNIVERSE_LIMIT || 0);
const http = axios.create({ timeout: 60000, headers: { 'User-Agent': UA } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function quarterOf(d) {
  return { y: d.getUTCFullYear(), q: Math.floor(d.getUTCMonth() / 3) + 1 };
}
function prevQuarter({ y, q }) {
  return q === 1 ? { y: y - 1, q: 4 } : { y, q: q - 1 };
}

// The quarterly index is the backbone of the run: a missed fetch silently
// drops thousands of filers, so retry before giving up (the Sep 7 run wrote
// 1,379 funds instead of 7,830 after one such miss).
async function masterIdx({ y, q }) {
  const url = `https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/master.idx`;
  let last = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await http.get(url, {
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
    });
    if (r.status === 200 && typeof r.data === 'string' && r.data.length > 1000) return r.data;
    if (r.status === 404) return null; // quarter index not published yet
    last = r.status;
    await sleep(4000 * (attempt + 1));
  }
  throw new Error(`master.idx ${y}Q${q} unavailable (HTTP ${last})`);
}

async function main() {
  const cur = quarterOf(new Date());
  const quarters = [prevQuarter(cur), cur]; // older first so newer wins
  const latestByCik = new Map();

  for (const qt of quarters) {
    let idx;
    try {
      idx = await masterIdx(qt);
    } catch (e) {
      // the previous quarter holds the bulk of current filers — without it the
      // universe would be a fraction of reality, so stop rather than publish it
      console.error(e.message);
      process.exit(1);
    }
    if (!idx) {
      console.log(`  ${qt.y}Q${qt.q}: index not published yet`);
      continue;
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
      if (!existing || existing.filed <= filed) {
        latestByCik.set(cik, { cik, name, filed, acc });
      }
    }
  }

  let entries = [...latestByCik.values()];
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);
  console.log(`Filers to process: ${entries.length}`);

  const rows = [];
  const stockAgg = new Map(); // cusip -> {issuer, value, funds}
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
            // the accession these numbers were computed from, so the filings
            // feed can attach them to that filing and not to a later amendment
            acc: e.acc,
            aum: Math.round(aum),
            positions: positions.length,
            top10: Number(top10.toFixed(1)),
          });
          // whale-heatmap aggregate across ALL filers (equity positions only)
          for (const p of positions) {
            if (p.putCall) continue;
            const a = stockAgg.get(p.cusip) || { issuer: p.issuer, value: 0, funds: 0 };
            a.value += p.value;
            a.funds++;
            stockAgg.set(p.cusip, a);
          }
        } catch {
          failed++;
        }
        done++;
        if (done % 200 === 0) console.log(`  ${done}/${entries.length} (failed: ${failed})`);
        await sleep(500); // 3 workers × 2 requests ≈ 7 req/s, under SEC's 10/s limit
      }
    })
  );

  rows.sort((a, b) => b.aum - a.aum);
  const pub = path.join(process.cwd(), 'client', 'public');
  fs.mkdirSync(pub, { recursive: true });

  // Never replace a good universe with a partial one: if this run found far
  // fewer filers than the committed file, something upstream failed.
  try {
    const prev = JSON.parse(fs.readFileSync(path.join(pub, 'universe.json'), 'utf8'));
    if (prev?.count && rows.length < prev.count * 0.7) {
      console.error(
        `Only ${rows.length} filers vs ${prev.count} in the committed universe — keeping the old file.`
      );
      process.exit(1);
    }
  } catch (e) {
    if (e?.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
  }
  fs.writeFileSync(
    path.join(pub, 'universe.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), count: rows.length, rows })
  );
  console.log(`Wrote ${rows.length} managers -> universe.json (failed: ${failed})`);

  // Rank all securities by total universe value
  const ranked = [...stockAgg.entries()]
    .map(([cusip, a]) => ({ cusip, ...a, value: Math.round(a.value) }))
    .sort((a, b) => b.value - a.value);

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

  const topStocks = ranked.slice(0, 500);
  fs.writeFileSync(
    path.join(pub, 'stocks.json'),
    JSON.stringify({
      updatedAt: new Date().toISOString(),
      rows: topStocks.map((s) => ({ ...s, ticker: tickers[s.cusip] ?? null })),
    })
  );
  console.log(`Wrote ${topStocks.length} stocks -> stocks.json`);
  writeUniverseSummary(pub);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

// Small companion file for the landing-page stat band: the full universe.json
// is ~1 MB, far too much to download just for three headline numbers.
export function writeUniverseSummary(pub) {
  const u = JSON.parse(fs.readFileSync(path.join(pub, 'universe.json'), 'utf8'));
  const rows = u.rows || [];
  const sum = (k) => rows.reduce((s, r) => s + (Number.isFinite(r[k]) ? r[k] : 0), 0);
  const summary = {
    updatedAt: u.updatedAt,
    count: rows.length,
    totalAum: Math.round(sum('aum')),
    totalPositions: sum('positions'),
  };
  fs.writeFileSync(path.join(pub, 'universe-summary.json'), JSON.stringify(summary));
  console.log(`Wrote universe-summary.json (${summary.count} funds, $${(summary.totalAum / 1e12).toFixed(2)}T)`);
  return summary;
}
