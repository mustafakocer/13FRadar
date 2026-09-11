// Stock split events for the securities in guru-history.json, from Yahoo's
// chart endpoint (events=splits). Writes api/_data/splits.json:
//   { updatedAt, byTicker: { AAPL: [{ date: '2020-08-31', ratio: 4 }, …] } }
// Historical 13F share counts are adjusted with this table so quarter-over-
// quarter share changes are comparable ("split-adjusted").
//
//   node scripts/build-splits.mjs        (runs after build-guru-history in consensus.yml)
// TODO: Yahoo is often blocked from datacenters; when that happens the
// previous table is kept. A second source (EDGAR 8-K item 8.01 / FMP) can
// be added behind the same schema.
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';

const root = process.cwd();
const OUT = path.join(root, 'api', '_data', 'splits.json');
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { byTicker: {} };
let history;
try {
  history = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'guru-history.json'), 'utf8'));
} catch {
  console.log('no guru-history.json yet — nothing to do');
  process.exit(0);
}
const tickers = new Set();
for (const g of Object.values(history.gurus)) for (const e of Object.values(g.positions)) if (e.ticker) tickers.add(e.ticker);

const byTicker = { ...prev.byTicker };
let ok = 0;
let failed = 0;
for (const t of tickers) {
  try {
    const { data } = await axios.get(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}`, {
      params: { range: '10y', interval: '3mo', events: 'splits' },
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    const ev = data?.chart?.result?.[0]?.events?.splits || {};
    byTicker[t] = Object.values(ev)
      .map((s) => ({ date: new Date(s.date * 1000).toISOString().slice(0, 10), ratio: s.numerator / s.denominator }))
      .filter((s) => s.ratio > 0 && s.ratio !== 1)
      .sort((a, b) => a.date.localeCompare(b.date));
    ok++;
  } catch {
    failed++;
    if (failed > 20 && ok === 0) {
      console.warn('Yahoo unreachable — keeping the previous splits table');
      process.exit(0);
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), byTicker }));
console.log(`splits.json: ${Object.keys(byTicker).length} tickers (${ok} refreshed, ${failed} failed)`);
