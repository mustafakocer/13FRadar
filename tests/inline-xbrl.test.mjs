import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineFacts, factValue } from '../api/_lib/inlineXbrl.js';
import { fundamentalsOf } from '../api/_lib/secFundamentals.js';

// B — numbers read from a filing's own document when companyfacts lacks them

const doc = `
<xbrli:context id="FY2025"><xbrli:entity><xbrli:identifier scheme="x">1046179</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="FY2025_seg"><xbrli:entity><xbrli:identifier scheme="x">1046179</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="ifrs-full:SegmentsAxis">tsm:Other</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
<xbrli:context id="Cover_A"><xbrli:entity><xbrli:identifier scheme="x">1067983</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">us-gaap:CommonClassAMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-07-21</xbrli:instant></xbrli:period></xbrli:context>
<xbrli:context id="Cover_B"><xbrli:entity><xbrli:identifier scheme="x">1067983</xbrli:identifier><xbrli:segment><xbrldi:explicitMember dimension="us-gaap:StatementClassOfStockAxis">us-gaap:CommonClassBMember</xbrldi:explicitMember></xbrli:segment></xbrli:entity><xbrli:period><xbrli:instant>2026-07-21</xbrli:instant></xbrli:period></xbrli:context>
<xbrli:unit id="TWDps"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>
<xbrli:unit id="TWD"><xbrli:measure>iso4217:TWD</xbrli:measure></xbrli:unit>
<xbrli:unit id="sh"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>
<p>EPS <ix:nonFraction name="ifrs-full:DilutedEarningsLossPerShare" contextRef="FY2025" unitRef="TWDps" decimals="2">66.30</ix:nonFraction></p>
<p>segment <ix:nonFraction name="ifrs-full:DilutedEarningsLossPerShare" contextRef="FY2025_seg" unitRef="TWDps" decimals="2">1.00</ix:nonFraction></p>
<p>NI <ix:nonFraction name="ifrs-full:ProfitLossAttributableToOwnersOfParent" contextRef="FY2025" unitRef="TWD" scale="6" decimals="-6" format="ixt:num-dot-decimal">1,717,867</ix:nonFraction></p>
<p>A <ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="Cover_A" unitRef="sh" decimals="0">520,452</ix:nonFraction> B <ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="Cover_B" unitRef="sh" decimals="0">1,348,467,980</ix:nonFraction></p>
`;

test('inline XBRL: non-dimensional facts, units, scale; the cover count per class', () => {
  const { facts } = inlineFacts(doc, ['ifrs-full:DilutedEarningsLossPerShare', 'ifrs-full:ProfitLossAttributableToOwnersOfParent', 'dei:EntityCommonStockSharesOutstanding'], { form: '20-F', filed: '2026-04-16', accn: 'X' });
  assert.deepEqual(facts['ifrs-full'].DilutedEarningsLossPerShare.units['TWD/shares'].map((e) => e.val), [66.3], 'the segment line is not the company');
  assert.equal(facts['ifrs-full'].ProfitLossAttributableToOwnersOfParent.units.TWD[0].val, 1_717_867_000_000);
  assert.deepEqual(facts.dei.EntityCommonStockSharesOutstanding.units.shares.map((e) => e.val), [520452, 1348467980]);
  assert.equal(factValue('<ix:nonFraction sign="-" scale="3">', '1,250'), -1_250_000);
  assert.equal(factValue('<ix:nonFraction format="ixt:num-comma-decimal">', '1.234,5'), 1234.5);
  assert.equal(factValue('<ix:nonFraction format="ixt:fixed-zero">', '—'), 0);
});

test('Berkshire from its cover: Class A at 1,500 B; EPS from net income over the listed shares', () => {
  const { facts: cover } = inlineFacts(doc, ['dei:EntityCommonStockSharesOutstanding'], { form: '10-Q', filed: '2026-08-03', accn: 'BRK-Q2' });
  const ni = [
    { start: '2025-07-01', end: '2025-09-30', val: 30e9 },
    { start: '2025-01-01', end: '2025-12-31', val: 67e9, form: '10-K', filed: '2026-02-28' },
    { start: '2025-01-01', end: '2025-03-31', val: 4.6e9 },
    { start: '2025-04-01', end: '2025-06-30', val: 12.4e9 },
    { start: '2026-01-01', end: '2026-03-31', val: 10.1e9 },
    { start: '2026-04-01', end: '2026-06-30', val: 25.7e9 },
  ].map((e) => ({ form: '10-Q', filed: e.end, accn: `N-${e.end}`, ...e }));
  const facts = { ...cover, 'us-gaap': { NetIncomeLoss: { units: { USD: ni } } } };
  const rule = { classes: [{ below: 5e6, ratio: 1500 }], epsDivisor: 1500 };
  const b = fundamentalsOf({ facts }, { cik: '1067983', classRule: rule, asOf: '2026-10-02' });
  const bEq = 520452 * 1500 + 1348467980;
  assert.equal(b.shares.value, bEq);
  // TTM 30 + (67 − 4.6 − 12.4 − 30) + 10.1 + 25.7 = 85.8 B
  assert.equal(Number(b.eps.value.toFixed(2)), Number((85.8e9 / bEq).toFixed(2)));
  assert.equal(b.eps.derivedFrom, 'net-income');
});
