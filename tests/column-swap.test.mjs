// A filer that swapped the value and share-count columns (CalSTRS 2026-Q2:
// NVIDIA as 7,007,449,934 shares worth $35,021,490) is read the right way
// round, judged on the filing as a whole against market closes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { columnSwap } from '../api/_lib/valueUnits.js';
import { aggregatePositions } from '../api/_lib/sec.js';

const CLOSE = { NVDA: 200.09, AAPL: 289.36, AMZN: 238.34, MSFT: 373.02, BAC: 51.5, T: 27.2, PFE: 25.1, GOOGL: 353.33 };
const closeOf = (r) => CLOSE[r.ticker] || null;
// [ticker, real shares, real dollars]
const BOOK = [['NVDA', 35021490, 7007449934], ['AAPL', 22278223, 6446426607], ['AMZN', 14696893, 3502857478], ['MSFT', 10707532, 3994123587], ['BAC', 10286935, 529777152], ['T', 10682454, 290562748], ['PFE', 9052386, 227214888], ['GOOGL', 8844847, 3125110000]];
const xmlRow = (t, shares, value) => ({ cusip: t, nameOfIssuer: t, value: String(value), shrsOrPrnAmt: { sshPrnamt: String(shares) } });

test('columnSwap: CalSTRS-like book is swapped, a normal one is not', () => {
  const swappedRows = BOOK.map(([t, s, v]) => ({ ticker: t, shares: v, value: s }));
  const v = columnSwap(swappedRows, '2026-06-30', { closeOf });
  assert.equal(v.swap, true);
  assert.ok(Math.abs(v.median - 1) < 0.05);
  const normal = BOOK.map(([t, s, v]) => ({ ticker: t, shares: s, value: v }));
  assert.equal(columnSwap(normal, '2026-06-30', { closeOf }).swap, false);
});

test('columnSwap: a book in thousands, a value=shares book and a short book are not swaps', () => {
  const thousands = BOOK.map(([t, s, v]) => ({ ticker: t, shares: s, value: v / 1000 }));
  assert.equal(columnSwap(thousands, '2026-06-30', { closeOf }).swap, false);
  // True Link 2026-Q2: the value column repeats the share count (price 1.00)
  const flat = BOOK.map(([t, s]) => ({ ticker: t, shares: s, value: s }));
  assert.equal(columnSwap(flat, '2026-06-30', { closeOf }).swap, false);
  const few = BOOK.slice(0, 3).map(([t, s, v]) => ({ ticker: t, shares: v, value: s }));
  assert.equal(columnSwap(few, '2026-06-30', { closeOf }).swap, false);
});

test('aggregatePositions: swaps the columns back before the unit check', () => {
  const rows = BOOK.map(([t, s, v]) => xmlRow(t, v, s));
  const agg = aggregatePositions(rows, '2026-08-24', { period: '2026-06-30', closeOf: (r) => CLOSE[r.cusip] || null });
  assert.equal(agg.columnFix?.swapped, true);
  const total = BOOK.reduce((a, [, , v]) => a + v, 0);
  assert.equal(Math.round(agg.aum), total);
  assert.equal(agg.positions[0].cusip, 'NVDA');
  assert.equal(agg.positions[0].shares, 35021490);
  assert.equal(agg.unitFix, undefined);
  // the same book filed correctly is left alone
  const ok = aggregatePositions(BOOK.map(([t, s, v]) => xmlRow(t, s, v)), '2026-08-24', { period: '2026-06-30', closeOf: (r) => CLOSE[r.cusip] || null });
  assert.equal(ok.columnFix, undefined);
  assert.equal(Math.round(ok.aum), total);
});
