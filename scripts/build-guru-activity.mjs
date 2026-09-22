// Per-quarter guru activity per ticker — the dataset behind /report.
//
//   node scripts/build-guru-activity.mjs        (npm run activity)
//
// One definition, one panel. The newest quarter is read straight out of the
// per-security table build-consensus.mjs wrote (api/_data/guru-stocks.json:
// `stocks` plus `exited`), so /report, the rankings and the landing page
// quote the same net dollars for the same name. Older quarters are pivoted
// out of guru-history.json through the same function (api/_lib/netActivity.js)
// over the same consensus panel (api/_lib/gurus.js) — with the caveat that
// the history keeps only positions that ranked in some quarter's top 100 per
// fund, so a wide book's tail is not in those quarters.
//
// Output (public, no paywall). The newest quarter ships in the index because
// that is what the page renders first and what SSR seeds; every older quarter
// is its own file, fetched only if the reader asks for it.
//   client/public/guru-activity.json          { updatedAt, quarters, coverage, names, rows: {newest: […]} }
//   client/public/guru-activity-<quarter>.json { rows: […], coverage }
//   row: t ticker · g gurus · ng new gurus · sh shares held
//        bs/ss shares bought/sold · b/s buyers/sellers · nv net value
//        tv total value held · sp [trailing net values, oldest first]
//        sec sector · mc market cap · etf  (from api/_data/sector-map.json)
//
// Env (tests): GURU_STOCKS_FILE, GURU_HISTORY_FILE, SECTOR_MAP_FILE,
// ACTIVITY_OUT_DIR.
import fs from 'node:fs';
import path from 'node:path';
import { isTradeable } from '../api/_lib/guruActivity.js';
import { netActivity, activityRow } from '../api/_lib/netActivity.js';
import { consensusPanel, coverage as coverageOf } from '../api/_lib/gurus.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const STOCKS = process.env.GURU_STOCKS_FILE || path.join(root, 'api', '_data', 'guru-stocks.json');
const HISTORY = process.env.GURU_HISTORY_FILE || path.join(root, 'api', '_data', 'guru-history.json');
const META = process.env.SECTOR_MAP_FILE || path.join(root, 'api', '_data', 'sector-map.json');
const OUT_DIR = process.env.ACTIVITY_OUT_DIR || path.join(root, 'client', 'public');
const OUT = path.join(OUT_DIR, 'guru-activity.json');

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

const table = read(STOCKS, null);
if (!Array.isArray(table?.stocks)) {
  console.error(`No per-security table at ${STOCKS} — run scripts/build-consensus.mjs first.`);
  process.exit(1);
}
const hist = read(HISTORY, null);
if (!hist?.gurus) console.warn(`No guru history at ${HISTORY} — only the newest quarter will be written.`);

// ---- newest quarter: the consensus table, keyed by ticker -------------------
const names = new Map();
const newest = table.quarter || (table.managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');
if (!newest) {
  console.error('The per-security table carries no quarter.');
  process.exit(1);
}
const mergeInto = (rows, r, ticker) => {
  const a = rows.get(ticker);
  if (!a) {
    rows.set(ticker, { ...r });
    return;
  }
  for (const k of ['g', 'ng', 'sh', 'bs', 'ss', 'nv', 'tv', 'b', 's']) a[k] += r[k];
};
const newestRows = new Map();
for (const s of [...table.stocks, ...(table.exited || [])]) {
  if (!isTradeable(s.ticker, s.issuer)) continue;
  if (!names.has(s.ticker)) names.set(s.ticker, s.issuer);
  mergeInto(newestRows, activityRow(s, s.ticker), s.ticker);
}

// ---- older quarters: the history, through the same function ----------------
// quarter → Map ticker → row
const perQuarter = new Map([[newest, newestRows]]);
const coverageByQuarter = new Map([[newest, table.coverage || null]]);
const quarters = [newest];
if (hist?.gurus) {
  const all = new Set();
  for (const g of Object.values(hist.gurus)) for (const q of g.quarters || []) if (q.reportDate < newest) all.add(q.reportDate);
  const older = [...all].sort().reverse().slice(0, QUARTERS - 1);
  const bookAt = (g, date) => {
    const positions = [];
    for (const [cusip, e] of Object.entries(g.positions || {})) {
      const r = (e.series || []).find((x) => x[0] === date);
      if (!r) continue;
      positions.push({ cusip, issuer: e.issuer || '', ticker: e.ticker || null, shares: r[1], value: r[2], weight: r[3] });
    }
    return { positions };
  };
  const prevOf = (g, date) => {
    const dates = (g.quarters || []).map((q) => q.reportDate).sort();
    const i = dates.indexOf(date);
    return i > 0 ? dates[i - 1] : null;
  };
  for (const quarter of older) {
    const panel = new Set(consensusPanel(quarter).map((g) => g.cik));
    const managers = [];
    const filed = new Map();
    for (const [cik, g] of Object.entries(hist.gurus)) {
      if (!(g.quarters || []).some((q) => q.reportDate === quarter)) continue;
      filed.set(cik, quarter);
      if (!panel.has(cik)) continue;
      const before = prevOf(g, quarter);
      managers.push({ cik, name: g.name, reportDate: quarter, cur: bookAt(g, quarter), prev: before ? bookAt(g, before) : null });
    }
    const rows = netActivity(managers, { idOf: (p) => p.ticker || String(p.cusip).toUpperCase() });
    const out = new Map();
    for (const r of rows.values()) {
      const ticker = /^[A-Z][A-Z.\-]{0,6}$/.test(r.id) ? r.id : null;
      if (!isTradeable(ticker, r.issuer)) continue;
      if (!names.has(ticker)) names.set(ticker, r.issuer);
      mergeInto(out, activityRow(r, ticker), ticker);
    }
    perQuarter.set(quarter, out);
    coverageByQuarter.set(quarter, { ...coverageOf(quarter, filed), source: 'guru-history' });
    quarters.push(quarter);
  }
}

// ---- assemble the exposed window ------------------------------------------
const exposed = quarters; // newest first
const ascending = [...exposed].reverse();
const netAt = (quarter, ticker) => perQuarter.get(quarter)?.get(ticker)?.nv ?? 0;

const rows = {};
const tickers = new Set();
for (const quarter of exposed) {
  const all = [...perQuarter.get(quarter).values()];
  // keep what a reader would actually scan: the biggest moves either way,
  // plus the largest holdings so the "most owned" view is complete
  const byMove = [...all].sort((x, y) => Math.abs(y.nv) - Math.abs(x.nv)).slice(0, PER_QUARTER);
  const byHeld = [...all].sort((x, y) => y.tv - x.tv).slice(0, Math.round(PER_QUARTER / 2));
  const keep = new Map();
  for (const r of [...byMove, ...byHeld]) keep.set(r.t, r);
  const qi = ascending.indexOf(quarter);
  const trail = ascending.slice(Math.max(0, qi - SPARK + 1), qi + 1);
  rows[quarter] = [...keep.values()].map((r) => ({ ...r, sp: trail.map((q) => netAt(q, r.t)) }));
  for (const r of keep.keys()) tickers.add(r);
}

// ---- sector, market cap, ETF flag ------------------------------------------
// From the map build-consensus.mjs keeps (api/_data/sector-map.json): SEC's
// SIC code per company, a share count times the chart price, and the
// instrument type Yahoo reports. Nothing is fetched here; a ticker the map
// has not classified yet simply has no sector column until the next pass.
const meta = read(META, {});
const sectorOf = (t) => {
  const s = meta.bySymbol?.[t];
  return s && s !== 'ETF' ? s : null;
};
const capOf = (t) => {
  const v = meta.caps?.[t]?.v;
  return Number.isFinite(v) && v > 0 ? v : null;
};
const isEtf = (t) => Boolean(meta.etf?.[t]) || meta.bySymbol?.[t] === 'ETF';
console.log(`Profiles: ${[...tickers].filter((t) => sectorOf(t) || capOf(t) || isEtf(t)).length} of ${tickers.size} tickers known to the sector map`);

let enriched = 0;
for (const quarter of exposed) {
  rows[quarter] = rows[quarter].map((r) => {
    const extra = {};
    const sec = sectorOf(r.t);
    const mc = capOf(r.t);
    if (sec) extra.sec = sec;
    if (mc) extra.mc = mc;
    if (isEtf(r.t)) extra.etf = 1;
    if (Object.keys(extra).length) enriched++;
    return { ...r, ...extra };
  });
}

// One name table instead of the same string repeated in every quarter.
const nameTable = {};
for (const ticker of tickers) nameTable[ticker] = names.get(ticker) || ticker;

const updatedAt = new Date().toISOString();
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify({ updatedAt, quarters: exposed, coverage: coverageByQuarter.get(newest), names: nameTable, rows: { [newest]: rows[newest] } })
);
let extra = 0;
for (const quarter of exposed.slice(1)) {
  const file = path.join(OUT_DIR, `guru-activity-${quarter}.json`);
  fs.writeFileSync(file, JSON.stringify({ updatedAt, quarter, coverage: coverageByQuarter.get(quarter), rows: rows[quarter] }));
  extra += fs.statSync(file).size;
}
const size = Math.round(fs.statSync(OUT).size / 1024);
console.log(
  `guru-activity.json: ${exposed.length} quarters (${exposed[exposed.length - 1]} → ${newest}), ` +
    `${rows[newest].length} rows in the newest (from the consensus table), ${tickers.size} tickers, ${enriched} enriched`
);
console.log(`  index ${size} KB + ${exposed.length - 1} quarter files ${Math.round(extra / 1024)} KB`);
