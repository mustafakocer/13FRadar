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
import { fetchInfoTableXml, parse13F, aggregatePositions, getSubmissions, list13F, getEffectiveHoldings } from '../api/_lib/sec.js';
import { mapCusipsToTickers } from '../api/_lib/figi.js';
import { persist as persistMaster, stats as masterStats } from '../api/_lib/securityMaster.js';
import { snapshotEntry } from '../api/_lib/latestHoldings.js';
import { inferPeriod, summarizeUniverse, universeRow, loadSameBooks } from '../api/_lib/universeSummary.js';
import { misfiledFor, markMisfiled } from '../api/_lib/misfiledBooks.js';

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

// How one master.idx answer reads. A full index is thousands of lines; the
// current quarter's index in its first days is the header and a handful of
// lines, or the header alone (2026-10-01 and 10-02: a 200 of a few hundred
// bytes, which the old length check took for a failed fetch and stopped the
// whole run on). The header line is what tells a real index from an error
// page, not its size.
//   'ok'     an index (any number of lines)
//   'empty'  not published yet (404)
//   'retry'  anything else: a throttle, an error page, a cut transfer
const MASTER_HEADER = /^CIK\|Company Name\|Form Type\|Date Filed\|File ?name\s*$/im;
export function readMasterIdx(status, body) {
  if (status === 404) return 'empty';
  if (status === 200 && typeof body === 'string' && MASTER_HEADER.test(body)) return 'ok';
  return 'retry';
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
    const kind = readMasterIdx(r.status, r.data);
    if (kind === 'ok') return r.data;
    if (kind === 'empty') return null; // quarter index not published yet
    last = `HTTP ${r.status}, ${typeof r.data === 'string' ? r.data.length : 0} bytes`;
    await sleep(4000 * (attempt + 1));
  }
  throw new Error(`master.idx ${y}Q${q} unavailable (${last})`);
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
      // universe would be a fraction of reality, so stop rather than publish it.
      // The current quarter only adds the filings since its first day: a run
      // without it is complete up to the quarter's end and is published.
      if (qt === cur) {
        console.warn(`  ${qt.y}Q${qt.q}: ${e.message} — built from ${quarters[0].y}Q${quarters[0].q} alone`);
        continue;
      }
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
      // several originals in the window (a filer catching up files many
      // periods on one day) means the newest filing date says nothing about
      // the newest period: those go through the submissions feed below
      const originals = (existing?.originals || 0) + (form === '13F-HR' ? 1 : 0);
      if (!existing || existing.filed <= filed) {
        latestByCik.set(cik, { cik, name, filed, acc, form, originals });
      } else existing.originals = originals;
    }
  }

  let entries = [...latestByCik.values()];
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);
  console.log(`Filers to process: ${entries.length}`);

  const rows = [];
  // the ten largest positions and the totals of every latest filing, so a
  // portfolio page's free view never has to go back to EDGAR for them
  const snapshot = {};
  const stockAgg = new Map(); // cusip -> {issuer, value, funds}
  let done = 0;
  let failed = 0;
  let amended = 0;
  const CONCURRENCY = 3;
  let i = 0;

  // The latest document of a filer, as the index lists it. When that is a
  // 13F-HR/A, the numbers to publish are not the amendment's own table (a
  // NEW HOLDINGS amendment is a handful of lines) but the effective snapshot
  // of the newest period: the original with the amendment applied. That
  // needs the filer's submissions feed for the period and the accessions —
  // one extra request for the few percent of filers whose latest is an
  // amendment. Everything else reads the one table as before.
  //
  // A filer with several originals in the window takes the same route: its
  // newest *period* is picked from the feed (Bullock Wealth filed seven
  // periods on 2026-09-24 and the last index line, its 2024-Q1 book, used to
  // be published as its current portfolio).
  //
  // The period also feeds the unit check (valueUnits.js): a single original
  // is dated from its filing date — a July filing reports June.
  async function latestSnapshot(e) {
    if (e.form !== '13F-HR/A' && (e.originals || 0) < 2) {
      const xml = await fetchInfoTableXml(e.cik, e.acc);
      const parsed = await parse13F(xml);
      const period = inferPeriod(e.filed);
      const { aum, positions, unitFix } = aggregatePositions(parsed, e.filed, { period });
      return { acc: e.acc, filed: e.filed, reportDate: period, periodFrom: 'filing-date', aum, positions, amendments: null, unitFix };
    }
    const filings = list13F(await getSubmissions(e.cik));
    const f = filings[0];
    if (!f) throw new Error('no 13F in the submissions feed');
    const { aum, positions, amendments, unitFix } = await getEffectiveHoldings(e.cik, f);
    if (e.form === '13F-HR/A') amended++;
    return { acc: f.acc, filed: f.filingDate, reportDate: f.reportDate, periodFrom: 'submissions', aum, positions, amendments: amendments || null, unitFix };
  }

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < entries.length) {
        const e = entries[i++];
        try {
          const snap = await latestSnapshot(e);
          const { aum, positions } = snap;
          rows.push(universeRow(e, snap));
          snapshot[e.cik.padStart(10, '0')] = snapshotEntry({
            acc: snap.acc,
            filed: snap.filed,
            reportDate: snap.reportDate,
            aum,
            positions,
            amendments: snap.amendments,
            unitFix: snap.unitFix,
          });
          // whale-heatmap aggregate across ALL filers (equity positions only);
          // a filing carrying another filer's table is not counted twice
          if (!misfiledFor(e.cik, snap.acc)) for (const p of positions) {
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
  const misfiled = markMisfiled(rows);
  if (misfiled) console.log(`${misfiled} filing(s) carrying another filer's table marked (config/misfiled-books.json)`);
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
  console.log(`Wrote ${rows.length} managers -> universe.json (failed: ${failed}, ${amended} whose latest document is an amendment, folded into their period)`);
  const snapDir = path.join(process.cwd(), 'api', '_data');
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(
    path.join(snapDir, 'latest-holdings.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), byCik: snapshot })
  );
  console.log(`Wrote ${Object.keys(snapshot).length} filers -> api/_data/latest-holdings.json`);

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
  // The answers went into the security master; it writes itself and the
  // derived flat map (api/_data/cusip-tickers.json). The map used to be
  // rewritten from this run's 6,000 names alone, dropping every mapping the
  // history and consensus builds had learnt in between.
  const mapped = Object.values(tickers).filter(Boolean).length;
  persistMaster({ force: true });
  const ms = masterStats();
  console.log(`security master: ${mapped} of ${Object.keys(tickers).length} universe names mapped; ${ms.resolved} resolved, ${ms.unresolved} unresolved -> api/_data/security-master.json (+ cusip-tickers.json)`);

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
// is ~1 MB, far too much to download just for three headline numbers. The
// numbers themselves come from universeSummary.js, the one definition the
// home page, the pricing page and the tooltips share.
export function writeUniverseSummary(pub) {
  const u = JSON.parse(fs.readFileSync(path.join(pub, 'universe.json'), 'utf8'));
  const summary = { updatedAt: u.updatedAt, ...summarizeUniverse(u.rows || [], { asOf: u.updatedAt, sameBooks: loadSameBooks(process.cwd()) }) };
  fs.writeFileSync(path.join(pub, 'universe-summary.json'), JSON.stringify(summary));
  console.log(`Wrote universe-summary.json (${summary.count} funds, ${summary.inTotal} in the ${summary.quarter} total, $${(summary.totalAum / 1e12).toFixed(2)}T)`);
  return summary;
}
