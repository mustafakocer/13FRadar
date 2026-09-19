import test from 'node:test';
import assert from 'node:assert/strict';
import { returnsTickers, mergeReturns, capsToRefresh } from '../api/_lib/stockMetaBuild.js';
import { figiIdType } from '../api/_lib/figi.js';
import { plausibleDates } from '../api/_lib/insiderModel.js';

// The enrichment pass: which symbols it asks about and how today's answers
// land on yesterday's file.

test('every ticker the table, the universe and the lists carry gets a return column', () => {
  const list = returnsTickers({
    guruStocks: { stocks: [{ ticker: 'aapl' }, { ticker: null }, { ticker: 'MSFT' }] },
    stocks: { rows: [{ ticker: 'KO' }, { ticker: 'MSFT' }] },
    consensus: { mostHeld: [{ ticker: 'BAC' }], topBought: [{ ticker: 'KO' }] },
  });
  assert.deepEqual(list.sort(), ['AAPL', 'BAC', 'IWM', 'KO', 'MSFT', 'QQQ', 'SPY']);
  assert.deepEqual(returnsTickers({}).sort(), ['IWM', 'QQQ', 'SPY']);
});

const snap = (ret1y, asOf = '2026-09-18') => ({ ret1y, retYtd: ret1y / 2, ret1d: 0.123456, asOf });

test('a fresh answer replaces the old row; a recent old row survives a miss', () => {
  const previous = {
    updatedAt: '2026-09-17T10:00:00Z',
    returns: { AAPL: { ret1y: 10, retYtd: 5, ret1d: 1 }, KO: { ret1y: 2, retYtd: 1, ret1d: 0 } },
  };
  const now = Date.parse('2026-09-19T00:00:00Z');
  const { returns, fresh } = mergeReturns(previous, new Map([['AAPL', snap(20)], ['MSFT', snap(30)], ['XYZ', null]]), { now });
  assert.equal(fresh, 2);
  assert.equal(returns.AAPL.ret1y, 20);
  assert.equal(returns.AAPL.ret1d, 0.12, 'rounded to two places');
  assert.equal(returns.MSFT.ret1y, 30);
  assert.deepEqual(returns.KO, { ret1y: 2, retYtd: 1, ret1d: 0, asOf: '2026-09-17' }, 'carried over, stamped with the file date it came from');
  assert.equal('XYZ' in returns, false, 'a symbol the provider does not know is not invented');
});

test('an old row past its shelf life drops out instead of posing as today', () => {
  const previous = { updatedAt: '2026-09-01T10:00:00Z', returns: { KO: { ret1y: 2, retYtd: 1, ret1d: 0 } } };
  const { returns } = mergeReturns(previous, new Map(), { now: Date.parse('2026-09-19T00:00:00Z') });
  assert.deepEqual(returns, {});
});

test('cap refresh asks best-ranked first for what is missing or stale, within budget', () => {
  const stocks = [{ ticker: 'AAPL' }, { ticker: null }, { ticker: 'KO' }, { ticker: 'BAC' }, { ticker: 'XOM' }];
  const caps = { AAPL: { v: 1, asOf: '2026-09-18' }, KO: { v: 1, asOf: '2026-08-01' } };
  const now = Date.parse('2026-09-19T00:00:00Z');
  assert.deepEqual(capsToRefresh(stocks, caps, { now, budget: 10 }), ['KO', 'BAC', 'XOM']);
  assert.deepEqual(capsToRefresh(stocks, caps, { now, budget: 1 }), ['KO']);
  assert.deepEqual(capsToRefresh(stocks, caps, { now, budget: 0 }), []);
});

test('a CINS is asked about as a CINS', () => {
  assert.equal(figiIdType('037833100'), 'ID_CUSIP'); // Apple
  assert.equal(figiIdType('L8681T102'), 'ID_CINS'); // Spotify
  assert.equal(figiIdType('N07059210'), 'ID_CINS'); // ASML
  assert.equal(figiIdType('g54950103'), 'ID_CINS'); // Linde, however it is cased
});

test('a trade dated after its own filing is not a trade', () => {
  assert.equal(plausibleDates('2026-09-01', '2026-09-03'), true);
  assert.equal(plausibleDates('2026-09-03', '2026-09-03'), true);
  assert.equal(plausibleDates('2027-09-03', '2026-09-03'), false);
  assert.equal(plausibleDates(null, '2026-09-03'), false);
  assert.equal(plausibleDates('2026-09-03', undefined), false);
});
