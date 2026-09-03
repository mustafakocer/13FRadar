import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTurkeyState, collectTurkey, finalizeTurkey, upsertHistory, narrativeTr, looksTurkish } from '../api/_lib/turkey.js';

const SEC = [{ ticker: 'TUR', cusip: '464286715', name: 'iShares MSCI Turkey ETF', kind: 'etf' }, { ticker: 'TKC', cusip: '900111204', name: 'Turkcell', kind: 'adr' }];
const P = (cusip, value, shares, weight = 1) => ({ cusip, issuer: cusip, value, shares, weight });

test('collect/finalize: holders, actions, totals, exits kept with prevValue', () => {
  const st = createTurkeyState(SEC);
  collectTurkey(st, { cik: 'A', name: 'Fund A' }, [P('464286715', 1000, 100, 2.5), P('X', 5, 1)], [P('464286715', 500, 50)]);
  collectTurkey(st, { cik: 'B', name: 'Fund B' }, [P('464286715', 300, 30, 0.4)], null);
  collectTurkey(st, { cik: 'C', name: 'Fund C' }, [P('X', 5, 1)], [P('464286715', 200, 20)]);
  collectTurkey(st, { cik: 'D', name: 'Fund D' }, [P('900111204', 50, 10, 0.1)], [P('900111204', 50, 10)]);
  const out = finalizeTurkey(st, '2026-06-30');
  const tur = out.find((s) => s.ticker === 'TUR');
  assert.deepEqual([tur.funds, tur.value, tur.shares, tur.adding, tur.reducing, tur.newCount, tur.exitCount, tur.diffFunds], [2, 1300, 130, 1, 1, 0, 1, 2]);
  assert.equal(tur.netFlow, 500 - 200);
  assert.deepEqual(tur.holders.map((h) => [h.cik, h.action]), [['A', 'ADD'], ['B', null], ['C', 'EXIT']]);
  assert.equal(tur.holders[2].prevValue, 200);
  const tkc = out.find((s) => s.ticker === 'TKC');
  assert.equal(tkc.holders[0].action, 'HOLD');
  assert.equal(looksTurkish('TURKCELL ILETISIM HIZMET'), true);
  assert.equal(looksTurkish('APPLE INC'), false);
});

test('upsertHistory keeps one row per period, sorted, capped', () => {
  const h = upsertHistory([{ period: '2026-03-31', funds: 5, value: 1, shares: 1, netFlow: 0 }], { period: '2026-06-30', funds: 6, value: 2, shares: 2, netFlow: 1 });
  assert.deepEqual(h.map((x) => x.period), ['2026-03-31', '2026-06-30']);
  const h2 = upsertHistory(h, { period: '2026-06-30', funds: 7, value: 3, shares: 3, netFlow: 2 });
  assert.equal(h2.length, 2);
  assert.equal(h2[1].funds, 7);
});

test('narrativeTr is generated from the numbers', () => {
  const s = { ticker: 'TUR', name: 'iShares MSCI Turkey ETF', kind: 'etf', period: '2026-06-30', funds: 143, value: 612e6, shares: 1, adding: 50, reducing: 34, newCount: 12, exitCount: 9, netFlow: 41e6, diffFunds: 120, holders: [{ name: 'Fund A', value: 100e6, weight: 1.25 }, { name: 'Fund B', value: 50e6, weight: 0.4 }] };
  const text = narrativeTr(s, [{ period: '2026-03-31', funds: 130, value: 500e6 }]);
  assert.ok(text.startsWith("2026 yılı 2. çeyreğinde 143 fon TUR ETF'sinde toplam 612 milyon dolar"));
  assert.ok(text.includes('%22,4 arttı'));
  assert.ok(text.includes('fon sayısı 13 arttı'));
  assert.ok(text.includes('38 fon pozisyonunu artırdı, 25 fon azalttı, 12 fon yeni girdi, 9 fon tamamen çıktı.'));
  assert.ok(text.includes('Tahmini net akış +41 milyon dolar (net alım).'));
  assert.ok(text.includes("Fund A (100 milyon dolar, portföyünün %1,3'i)"));
  const none = narrativeTr({ ...s, funds: 0, holders: [] });
  assert.ok(none.includes('hiçbir 13F dosyalayıcısı'));
});
