// Is a 13F filing's value column in dollars or in thousands?
//
// The rule (sec.js valueMultiplier): filings made on or after 2023-01-03 are
// in whole dollars, earlier ones in thousands. Filers break it both ways —
// Select Equity wrote dollars into 2019–2021 filings (TSM at $56,770 a share,
// a $5B quarter shown as $93B), Duquesne and 330 other books still write
// thousands after 2023 (T. Rowe Price as a $1B fund). The old check only
// looked at whether the median implied price was physically possible, so it
// missed both.
//
// Here each filing is judged as a whole against market prices: the implied
// price of every row we can price (value ÷ shares) is divided by that
// security's close at the period end. A book in the right unit sits near 1
// (splits and odd lines move single rows, not the median); a book in the
// wrong unit sits near 1000 or 1/1000. The filing is rescaled only when the
// median ratio is in the wrong band AND more than half the priced rows agree — never row by
// row. Rows with no price take the filing's factor with the rest.
//
// Without prices (a book of unpriced names) the old physical-price rule
// still applies (sec.js detectValueScale).
import { readSeries } from './priceStore.js';
import { tickerFor } from './securityMaster.js';

export const WRONG_BAND = [300, 3000];
export const MIN_PRICED = 3;
// more than half of the priced rows must sit in the wrong band
export const MIN_AGREE = 0.5;

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};

// Close on the last trading day at or before `date` (within a week), or null.
export function closeOn(ticker, date) {
  const s = ticker ? readSeries(ticker) : null;
  if (!s?.prices?.length || !date) return null;
  const p = s.prices;
  let lo = 0;
  let hi = p.length - 1;
  if (p[0].date > date) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p[mid].date <= date) lo = mid;
    else hi = mid - 1;
  }
  const hit = p[lo];
  const gap = (Date.parse(date) - Date.parse(hit.date)) / 86_400_000;
  return gap <= 7 && hit.close > 0 ? hit.close : null;
}

// ratios: implied price ÷ close for each priced row of one filing.
// → { factor: 1 | 1/1000 | 1000, median, priced, agree }
export function unitVerdict(ratios) {
  const r = ratios.filter((x) => Number.isFinite(x) && x > 0);
  const m = median(r);
  if (r.length < MIN_PRICED) return { factor: 1, median: m, priced: r.length, agree: null };
  const hi = (x) => x >= WRONG_BAND[0] && x <= WRONG_BAND[1];
  const lo = (x) => x >= 1 / WRONG_BAND[1] && x <= 1 / WRONG_BAND[0];
  for (const [inBand, factor] of [[hi, 1 / 1000], [lo, 1000]]) {
    if (!inBand(m)) continue;
    const agree = r.filter(inBand).length / r.length;
    if (agree > MIN_AGREE) return { factor, median: m, priced: r.length, agree };
  }
  return { factor: 1, median: m, priced: r.length, agree: null };
}

// rows: [{ cusip, ticker?, putCall?, shares, value }] with value already in
// dollars under the stated unit. Options and principal amounts don't vote.
export function filingScale(rows, period, { closeOf = defaultCloseOf } = {}) {
  const ratios = [];
  for (const r of rows) {
    if (r.putCall || !(r.shares > 0) || !(r.value > 0)) continue;
    const close = closeOf(r, period);
    if (close) ratios.push(r.value / r.shares / close);
  }
  return unitVerdict(ratios);
}

export function defaultCloseOf(row, period) {
  const ticker = row.ticker || tickerFor(row.cusip);
  return ticker ? closeOn(ticker, period) : null;
}

// The record kept for every rescaled filing (api/_data/unit-corrections.json).
export function correctionEntry({ cik, name, period, acc, filed, verdict, source }) {
  const wrong = verdict.factor < 1 ? 'dollars written into a thousands filing' : 'thousands written into a dollars filing';
  const m = Number(verdict.median);
  const evidence = verdict.by === 'audit-full-table'
    ? 'every priced row of the full table (universe audit; the stored top lines had too few prices to decide)'
    : Number.isFinite(m)
    ? `median implied price ÷ close = ${m >= 1 ? Math.round(m) : m.toPrecision(3)} over ${verdict.priced} priced rows (${Math.round((verdict.agree || 0) * 100)}% agree)`
    : 'median implied share price outside any traded price';
  return { cik, name: name || null, period: period || null, acc: acc || null, filed: filed || null, factor: verdict.factor, reason: `${evidence}: ${wrong}`, source };
}
