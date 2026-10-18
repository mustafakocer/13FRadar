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
