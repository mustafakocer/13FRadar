// Per-quarter guru activity per ticker — the dataset behind /report.
//
//   node scripts/build-guru-activity.mjs        (npm run activity)
//
// guru-history.json already stores, for every tracked superinvestor, a series
// of [reportDate, shares, value, weight] per position. Pivoting that by
// quarter gives what a "who is buying what" table needs and consensus.json
// cannot express: share counts, quarter-over-quarter deltas, how many gurus
// held the name each quarter, and a short trailing series per ticker.
//
// Output (public, no paywall). The newest quarter ships in the index because
// that is what the page renders first and what SSR seeds; every older quarter
// is its own file, fetched only if the reader asks for it. One combined file
// would put every quarter into the server-rendered state of every page view.
//   client/public/guru-activity.json          { updatedAt, quarters, names, rows: {newest: […]} }
//   client/public/guru-activity-<quarter>.json { rows: […] }
//   row: t ticker · n name · g gurus · ng new gurus · sh shares held
//        bs/ss shares bought/sold · b/s buyers/sellers · nv net value
//        tv total value held · sp [trailing net values, oldest first]
//        sec sector · mc market cap · etf  (the last three only with FMP)
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { isTradeable, quarterDeltas } from '../api/_lib/guruActivity.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(root, 'api', '_data', 'guru-history.json');
const META = path.join(root, 'api', '_data', 'ticker-meta.json');
const OUT = path.join(root, 'client', 'public', 'guru-activity.json');

const QUARTERS = Number(process.env.ACTIVITY_QUARTERS || 8); // quarters exposed
const SPARK = 4; // trailing quarters drawn in the activity column
const PER_QUARTER = Number(process.env.ACTIVITY_ROWS || 200);

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const hist = read(SRC, null);
if (!hist?.gurus) {
  console.error(`No guru history at ${SRC} — run scripts/build-guru-history.mjs first.`);
  process.exit(1);
}

// ---- pivot: quarter -> ticker -> { shares, value, gurus } ------------------
const byQuarter = new Map();
const names = new Map();
for (const [cik, guru] of Object.entries(hist.gurus)) {
  for (const pos of Object.values(guru.positions || {})) {
    if (!isTradeable(pos.ticker, pos.issuer)) continue;
    if (!names.has(pos.ticker)) names.set(pos.ticker, pos.issuer);
    for (const [quarter, shares, value] of pos.series || []) {
      if (!byQuarter.has(quarter)) byQuarter.set(quarter, new Map());
      const rows = byQuarter.get(quarter);
      const a = rows.get(pos.ticker) || { shares: 0, value: 0, perGuru: new Map() };
      a.shares += shares || 0;
      a.value += value || 0;
      a.perGuru.set(cik, (a.perGuru.get(cik) || 0) + (shares || 0));
      rows.set(pos.ticker, a);
    }
  }
}

const quarters = [...byQuarter.keys()].sort(); // oldest first while computing
if (!quarters.length) {
  console.error('No quarters found in the history file.');
  process.exit(1);
}

const perQuarter = new Map();
for (let i = 0; i < quarters.length; i++) {
  const prev = i > 0 ? byQuarter.get(quarters[i - 1]) : null;
  perQuarter.set(quarters[i], quarterDeltas(byQuarter.get(quarters[i]), prev));
}

// ---- assemble the exposed window ------------------------------------------
const exposed = quarters.slice(-QUARTERS).reverse(); // newest first
// indexed once: the sparkline asks for every ticker in every trailing quarter
const netIndex = new Map(
  [...perQuarter].map(([q, list]) => [q, new Map(list.map((r) => [r.t, r.nv]))])
);
const netAt = (quarter, ticker) => netIndex.get(quarter)?.get(ticker) ?? 0;

const rows = {};
const tickers = new Set();
for (const quarter of exposed) {
  const all = perQuarter.get(quarter) || [];
  // keep what a reader would actually scan: the biggest moves either way,
  // plus the largest holdings so the "most owned" view is complete
  const byMove = [...all].sort((x, y) => Math.abs(y.nv) - Math.abs(x.nv)).slice(0, PER_QUARTER);
  const byHeld = [...all].sort((x, y) => y.tv - x.tv).slice(0, Math.round(PER_QUARTER / 2));
  const keep = new Map();
  for (const r of [...byMove, ...byHeld]) keep.set(r.t, r);

  const qi = quarters.indexOf(quarter);
  const trail = quarters.slice(Math.max(0, qi - SPARK + 1), qi + 1);
  rows[quarter] = [...keep.values()].map((r) => ({
    ...r,
    sp: trail.map((q) => netAt(q, r.t)),
  }));
  for (const r of keep.keys()) tickers.add(r);
}

// ---- optional company profile (sector, market cap, ETF flag) ---------------
// Without FMP_API_KEY the three columns that need it are simply absent and the
// page hides them, exactly like the penny board's price columns.
async function profiles(symbols) {
  const meta = { ...read(META, {}) };
  const key = process.env.FMP_API_KEY;
  if (!key) {
    console.log('FMP_API_KEY unset — sector / market cap / ETF columns will be omitted.');
    return meta;
  }
  const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const unknown = symbols.filter((s) => meta[s]?.sector == null && meta[s]?.etf == null);
  console.log(`Profiles: ${unknown.length} unknown of ${symbols.length} tickers`);
  for (const group of chunk(unknown, 50).slice(0, 30)) {
    try {
      const { data } = await axios.get('https://financialmodelingprep.com/stable/profile', {
        params: { symbol: group.join(','), apikey: key },
        timeout: 20000,
        validateStatus: () => true,
      });
      for (const p of Array.isArray(data) ? data : []) {
        const sym = String(p.symbol || '').toUpperCase();
        if (!sym) continue;
        meta[sym] = {
          ...(meta[sym] || {}),
          sector: p.sector || null,
          mcap: Number(p.marketCap ?? p.mktCap) || meta[sym]?.mcap || null,
          etf: Boolean(p.isEtf),
        };
      }
    } catch {
      /* enrichment is optional */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return meta;
}

const meta = await profiles([...tickers]);
fs.writeFileSync(META, JSON.stringify(meta));

let enriched = 0;
for (const quarter of exposed) {
  rows[quarter] = rows[quarter].map((r) => {
    const m = meta[r.t] || {};
    const extra = {};
    if (m.sector) extra.sec = m.sector;
    if (Number.isFinite(m.mcap) && m.mcap > 0) extra.mc = m.mcap;
    if (m.etf) extra.etf = 1;
    if (Object.keys(extra).length) enriched++;
    return { ...r, ...extra };
  });
}

// One name table instead of the same string repeated in every quarter.
const nameTable = {};
for (const ticker of tickers) nameTable[ticker] = names.get(ticker) || ticker;

const newest = exposed[0];
const updatedAt = new Date().toISOString();
fs.writeFileSync(
  OUT,
  JSON.stringify({ updatedAt, quarters: exposed, names: nameTable, rows: { [newest]: rows[newest] } })
);
let extra = 0;
for (const quarter of exposed.slice(1)) {
  const file = path.join(path.dirname(OUT), `guru-activity-${quarter}.json`);
  fs.writeFileSync(file, JSON.stringify({ updatedAt, quarter, rows: rows[quarter] }));
  extra += fs.statSync(file).size;
}
const size = Math.round(fs.statSync(OUT).size / 1024);
console.log(
  `guru-activity.json: ${exposed.length} quarters (${exposed[exposed.length - 1]} → ${newest}), ` +
    `${rows[newest].length} rows in the newest, ${tickers.size} tickers, ${enriched} enriched`
);
console.log(`  index ${size} KB + ${exposed.length - 1} quarter files ${Math.round(extra / 1024)} KB`);
