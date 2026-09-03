import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveThemes, createThemeStates, collectThemes, finalizeThemes } from '../api/_lib/themes.js';

const THEMES = [{ id: 'gold', name: 'Altın', nameEn: 'Gold', icon: 'g', securities: [{ ticker: 'GLD', cusip: '78463V107', name: 'SPDR Gold', kind: 'etf' }, { ticker: 'IAU', name: 'iShares Gold', kind: 'etf' }, { ticker: 'ZZZ', name: 'Unknown', kind: 'etf' }] }];
const P = (cusip, value, shares, weight = 1) => ({ cusip, issuer: cusip, value, shares, weight });

test('resolveThemes: explicit cusip wins, ticker resolved from map, unresolved dropped', () => {
  const r = resolveThemes(THEMES, { '464285204': 'IAU', X: 'GLD' });
  assert.deepEqual(r[0].securities.map((s) => [s.ticker, s.cusip]), [['GLD', '78463V107'], ['IAU', '464285204']]);
});

test('collect + finalize: distinct holders, totals, per-security history and narrative, theme history rotation', () => {
  const states = createThemeStates(resolveThemes(THEMES, { '464285204': 'IAU' }));
  collectThemes(states, { cik: 'A', name: 'Fund A' }, [P('78463V107', 100, 10, 2), P('464285204', 50, 5, 1)], [P('78463V107', 80, 8)]);
  collectThemes(states, { cik: 'B', name: 'Fund B' }, [P('78463V107', 20, 2, 0.5)], null);
  const prev = { themes: [{ id: 'gold', history: [{ period: '2026-03-31', funds: 1, value: 80, shares: 8, netFlow: 0 }], securities: [{ cusip: '78463V107', history: [{ period: '2026-03-31', funds: 1, value: 80, shares: 8, netFlow: 0 }] }] }] };
  const out = finalizeThemes(states, '2026-06-30', prev);
  const g = out[0];
  assert.equal(g.funds, 2, 'distinct holders across securities');
  assert.equal(g.value, 170);
  assert.deepEqual(g.history.map((h) => h.period), ['2026-03-31', '2026-06-30']);
  assert.equal(g.securities[0].ticker, 'GLD');
  assert.equal(g.securities[0].history.length, 2);
  assert.ok(g.securities[0].narrative.includes('2 fon GLD'));
  assert.equal(g.securities[1].history.length, 1);
});
