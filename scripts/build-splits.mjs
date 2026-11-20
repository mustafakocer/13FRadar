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
// refuses (no key, plan, quota) the previous table is kept as it is — and
// the run says so: the provider's answer goes to the known-issue alarm
// (providerAlarm.js) and api/_data/freshness/splits.json records how many
// tickers were re-checked, which is what the freshness check reads
// (api/_lib/splitsRun.js tells why).
import fs from 'node:fs';
import path from 'node:path';
import { tdGet, hasTd } from '../api/_lib/providers.js';
import { flushProviderHealth, noteProvider } from '../api/_lib/providerAlarm.js';
import { recheckSpan, recheckSplits, splitsRunRecord } from '../api/_lib/splitsRun.js';

const root = process.cwd();
const OUT = path.join(root, 'api', '_data', 'splits.json');
// The footer's "last updated" date: the day the table's content last
// changed (dataChangedAt), not the day this script last ran.
const STATUS = path.join(root, 'client', 'public', 'splits-status.json');
// lastCheckedAt: the newest day any ticker was re-checked against the
// provider — null while none has been.
const writeStatus = (dataChangedAt, lastCheckedAt = null) => fs.writeFileSync(STATUS, `${JSON.stringify({ dataChangedAt: dataChangedAt || null, lastCheckedAt })}\n`);
// the run's health record, committed with the night's data (consensus.yml)
const RECORD = path.join(root, 'api', '_data', 'freshness', 'splits.json');
const writeRecord = (run, reason = null) => {
  let before = {};
  try {
    before = JSON.parse(fs.readFileSync(RECORD, 'utf8'));
  } catch {
    /* first record */
  }
  const rec = splitsRunRecord({ prev: before, run, reason });
  fs.mkdirSync(path.dirname(RECORD), { recursive: true });
  fs.writeFileSync(RECORD, JSON.stringify(rec, null, 1));
  return rec;
};
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
const tickers = new Set();
for (const g of Object.values(history.gurus)) for (const e of Object.values(g.positions)) if (e.ticker) tickers.add(e.ticker);
if (!hasTd() || !(BUDGET > 0)) {
  console.log('splits: no TWELVEDATA_API_KEY or no budget — keeping the previous table');
  writeStatus(prev.dataChangedAt, recheckSpan(prev).newest);
  // By hand without a key this is expected. In the nightly job it means the
  // table is not being refreshed, and that must not pass as a green run.
  if (process.env.GITHUB_ACTIONS === 'true') {
    const why = hasTd() ? `SPLITS_BUDGET is ${process.env.SPLITS_BUDGET}` : 'TWELVEDATA_API_KEY is not set';
    writeRecord({ candidates: tickers.size }, `split table not refreshed: ${why}`);
    console.warn(`::warning::splits: ${why} — the split table was not re-checked`);
  }
  process.exit(0);
}

const checked = { ...(prev.checked || {}) };
const byTicker = { ...prev.byTicker };
// never checked first, then the oldest check
const queue = [...tickers].sort((a, b) => String(checked[a] || '').localeCompare(String(checked[b] || ''))).slice(0, BUDGET);
const today = new Date().toISOString().slice(0, 10);
const run = await recheckSplits({
  queue,
  today,
  byTicker,
  checked,
  get: (t) => tdGet('/splits', { symbol: t, range: 'full' }),
  note: noteProvider,
  wait: () => sleep(7600), // 8 credits a minute on the free plan
});
const changed = JSON.stringify(byTicker) !== JSON.stringify(prev.byTicker || {});
const dataChangedAt = changed ? today : prev.dataChangedAt || null;
fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), dataChangedAt, checked, byTicker }));
writeStatus(dataChangedAt, recheckSpan({ checked }).newest);
const rec = writeRecord(run);
flushProviderHealth();
console.log(`splits.json: ${Object.keys(byTicker).length} tickers (${run.rechecked} re-checked tonight of ${tickers.size}, ${run.failed} failed)`);
// Not an exit code: the steps after this one must still publish the night's
// data. The record above is what turns the freshness check, and a plan
// refusal has already gone to the provider alarm.
if (rec.last_error) console.warn(`::warning::splits: ${rec.last_error}`);
