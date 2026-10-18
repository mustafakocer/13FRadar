import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregatePositions } from '../api/_lib/sec.js';
import { snapshotEntry } from '../api/_lib/latestHoldings.js';

const row = (cusip, value, amt, type = 'SH', putCall = '') => ({ cusip, nameOfIssuer: cusip, titleOfClass: 'COM', value, putCall, shrsOrPrnAmt: { sshPrnamt: amt, sshPrnamtType: type } });

test('13F: a note line keeps its principal amount and says so; share lines do not', () => {
  const { positions } = aggregatePositions([row('37940XAU6', 230000000, 247500000, 'PRN'), row('037833100', 900000000, 4000000)], '2026-08-14');
  const note = positions.find((p) => p.cusip === '37940XAU6');
  assert.equal(note.prn, true);
  assert.equal(note.shares, 247500000);
  assert.equal(positions.find((p) => p.cusip === '037833100').prn, undefined);
});

test('latest-holdings: the option notional inside the total and the note flag are stored', () => {
  const positions = [
    { cusip: 'A', putCall: '', issuer: 'A', value: 700, shares: 7, weight: 70 },
    { cusip: 'A', putCall: 'Put', issuer: 'A', value: 200, shares: 2, weight: 20 },
    { cusip: 'N', putCall: '', issuer: 'N', value: 100, shares: 100, prn: true, weight: 10 },
  ];
  const e = snapshotEntry({ acc: 'x', filed: '2026-08-14', aum: 1000, positions });
  assert.equal(e.aum, 1000);
  assert.equal(e.putCallValue, 200);
  assert.equal(e.top.find((p) => p.cusip === 'N').prn, true);
  assert.equal(e.top.find((p) => p.cusip === 'A' && !p.putCall).prn, undefined);
});

test('fund page: the portfolio is the shares value, in the headline, the description and the FAQ', async () => {
  const { portfolioValue, guruAnswer } = await import('../client/src/lib/answerBox.js');
  const { managerSeo } = await import('../client/src/lib/seoTemplates.js');
  const holdings = { aum: 875011794337, optionValue: 700875428616, count: 13572, positions: [{ ticker: 'SPY', issuer: 'SPDR', weight: 4.08, putCall: 'Call' }] };
  assert.equal(portfolioValue(holdings), 174136365721);
  assert.equal(portfolioValue({ aum: 100 }), 100, 'no options: the total');
  assert.equal(portfolioValue(null), null);
  const seo = managerSeo({ lang: 'tr', cik: '0001423053', manager: { name: 'Citadel' }, filing: { reportDate: '2026-06-30', filingDate: '2026-08-14' }, holdings });
  const all = JSON.stringify(seo);
  assert.match(all, /\$174\.14B/);
  assert.doesNotMatch(all, /\$875\.01B/);
  assert.ok(guruAnswer);
});
