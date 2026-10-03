// Stock split events for the securities in guru-history.json, from Twelve
// Data's /splits (TWELVEDATA_API_KEY). Writes api/_data/splits.json:
//   { updatedAt, checked: { AAPL: '2026-10-02', … }, byTicker: { AAPL: [{ date: '2020-08-31', ratio: 4 }, …] } }
// Historical 13F share counts are adjusted with this table so quarter-over-
// quarter share changes are comparable ("split-adjusted").
//
//   node scripts/build-splits.mjs        (runs after build-guru-history in consensus.yml)
//
// Yahoo's chart (events=splits) used to answer this for every ticker every
// night; it is out of every chain (its terms do not cover a paid site). The
// free Twelve Data plan has a daily credit budget, so each night re-checks
// the tickers checked longest ago, SPLITS_BUDGET of them (default 60), and a
// table entry stays until its ticker comes round again. When the provider
// refuses (no key, plan, quota) the previous table is kept as it is.
import fs from 'node:fs';
import path from 'node:path';
import { tdGet, hasTd } from '../api/_lib/providers.js';

const root = process.cwd();
const OUT = path.join(root, 'api', '_data', 'splits.json');
// The footer's "last updated" date: the day the table's content last
// changed (dataChangedAt), not the day this script last ran.
const STATUS = path.join(root, 'client', 'public', 'splits-status.json');
const writeStatus = (dataChangedAt) => fs.writeFileSync(STATUS, `${JSON.stringify({ dataChangedAt: dataChangedAt || null })}\n`);
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { byTicker: {} };
const BUDGET = Number(process.env.SPLITS_BUDGET || 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let history;
try {
  history = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'guru-history.json'), 'utf8'));
} catch {
  console.log('no guru-history.json yet — nothing to do');
  process.exit(0);
}
if (!hasTd() || !(BUDGET > 0)) {
  console.log('splits: no TWELVEDATA_API_KEY or no budget — keeping the previous table');
  writeStatus(prev.dataChangedAt);
  process.exit(0);
}
const tickers = new Set();
for (const g of Object.values(history.gurus)) for (const e of Object.values(g.positions)) if (e.ticker) tickers.add(e.ticker);

const checked = { ...(prev.checked || {}) };
const byTicker = { ...prev.byTicker };
// never checked first, then the oldest check
const queue = [...tickers].sort((a, b) => String(checked[a] || '').localeCompare(String(checked[b] || ''))).slice(0, BUDGET);
const today = new Date().toISOString().slice(0, 10);
let ok = 0;
let failed = 0;
for (const t of queue) {
  try {
    const d = await tdGet('/splits', { symbol: t, range: 'full' });
    byTicker[t] = (d?.splits || [])
      .map((s) => ({ date: String(s.date).slice(0, 10), ratio: Number(s.to_factor) / Number(s.from_factor) }))
      .filter((s) => Number.isFinite(s.ratio) && s.ratio > 0 && s.ratio !== 1)
      .sort((a, b) => a.date.localeCompare(b.date));
    checked[t] = today;
    ok++;
  } catch (e) {
    failed++;
    const msg = String(e.message || e);
    if (/run out|limit|credits|429|plan|upgrade|access/i.test(msg)) {
      console.warn(`splits: Twelve Data refused (${msg}) — stopping, the rest keep their entries`);
      break;
    }
  }
  await sleep(7600); // 8 credits a minute on the free plan
}
const changed = JSON.stringify(byTicker) !== JSON.stringify(prev.byTicker || {});
const dataChangedAt = changed ? today : prev.dataChangedAt || null;
fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), dataChangedAt, checked, byTicker }));
writeStatus(dataChangedAt);
console.log(`splits.json: ${Object.keys(byTicker).length} tickers (${ok} re-checked tonight of ${tickers.size}, ${failed} failed)`);
