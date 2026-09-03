import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseForm4Xml, classifyRole, mergeFeed, parseDailyIndex } from '../api/_lib/form4.js';

const XML = `<?xml version="1.0"?>
<ownershipDocument>
  <issuer><issuerCik>0000320193</issuerCik><issuerName>Apple Inc.</issuerName><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer>
  <reportingOwner>
    <reportingOwnerId><rptOwnerCik>0001214156</rptOwnerCik><rptOwnerName>COOK TIMOTHY D</rptOwnerName></reportingOwnerId>
    <reportingOwnerRelationship><isDirector>0</isDirector><isOfficer>1</isOfficer><isTenPercentOwner>0</isTenPercentOwner><officerTitle>Chief Executive Officer</officerTitle></reportingOwnerRelationship>
  </reportingOwner>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-08-20</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>100000</value></transactionShares><transactionPricePerShare><value>229.5</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>3200000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-08-20</value></transactionDate>
      <transactionCoding><transactionCode>F</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>500</value></transactionShares><transactionPricePerShare><value></value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <derivativeTable>
    <derivativeTransaction>
      <transactionDate><value>2026-08-20</value></transactionDate>
      <transactionCoding><transactionCode>M</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>100000</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts>
    </derivativeTransaction>
  </derivativeTable>
</ownershipDocument>`;

test('parseForm4Xml: issuer, role, sides, value, derivative flag, zero-value price', async () => {
  const tx = await parseForm4Xml(XML, { acc: '0001-26-000001', filed: '2026-08-22' });
  assert.equal(tx.length, 3);
  const sale = tx[0];
  assert.equal(sale.issuerCik, '320193');
  assert.equal(sale.symbol, 'AAPL');
  assert.equal(sale.owner, 'COOK TIMOTHY D');
  assert.equal(sale.role, 'CEO');
  assert.equal(sale.side, 'sell');
  assert.equal(sale.code, 'S');
  assert.equal(sale.value, 22950000);
  assert.equal(sale.ownedAfter, 3200000);
  assert.equal(sale.derivative, false);
  assert.equal(tx[1].price, null, 'empty price -> null');
  assert.equal(tx[1].value, null);
  assert.equal(tx[2].derivative, true);
  assert.deepEqual(await parseForm4Xml('<nope/>', { acc: 'x' }), []);
});

test('classifyRole', () => {
  assert.equal(classifyRole({ officerTitle: 'Chief Financial Officer' }), 'CFO');
  assert.equal(classifyRole({ officerTitle: 'President and CEO' }), 'CEO');
  assert.equal(classifyRole({ officerTitle: 'EVP, Chief Operating Officer' }), 'COO');
  assert.equal(classifyRole({ officerTitle: 'Vice President' }), 'OFFICER');
  assert.equal(classifyRole({ officerTitle: 'President' }), 'PRESIDENT');
  assert.equal(classifyRole({ isDirector: '1' }), 'DIRECTOR');
  assert.equal(classifyRole({ isTenPercentOwner: 'true' }), 'TEN_PCT');
  assert.equal(classifyRole({}), 'OTHER');
});

test('mergeFeed: dedupe, prune by age, open-market only, min value, order', () => {
  const t = (acc, date, code, value, extra = {}) => ({ acc, date, filed: date, issuerCik: '1', issuer: 'X', symbol: 'X', owner: 'O', title: null, role: 'OTHER', code, side: code === 'P' ? 'buy' : 'sell', shares: 10, price: value / 10, value, ownedAfter: null, derivative: false, ...extra });
  const existing = [t('A', '2026-08-01', 'P', 50000), t('OLD', '2026-06-01', 'P', 1e6)];
  const fresh = [t('A', '2026-08-01', 'P', 50000), t('B', '2026-08-30', 'S', 200000), t('C', '2026-08-30', 'S', 900000), t('D', '2026-08-29', 'F', 5e6), t('E', '2026-08-28', 'P', 100), t('DER', '2026-08-28', 'P', 5e6, { derivative: true })];
  const rows = mergeFeed(existing, fresh, { now: '2026-09-03', keepDays: 30, minValue: 1000 });
  assert.deepEqual(rows.map((r) => r.acc), ['C', 'B'], 'A (2026-08-01) is older than the 30-day window');
});

test('parseDailyIndex: form 4 lines only', () => {
  const idx = `Form Type   Company Name   CIK   Date Filed   File Name
---
4           Apple Inc.                                                    320193      20260902    edgar/data/320193/0001214156-26-000123.txt
4/A         Some Corp                                                     123456      20260902    edgar/data/123456/0000123456-26-000001.txt
13F-HR      Berkshire Hathaway Inc                                        1067983     20260902    edgar/data/1067983/0000950123-26-000001.txt
`;
  const rows = parseDailyIndex(idx);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { form: '4', company: 'Apple Inc.', cik: '320193', filed: '2026-09-02', acc: '0001214156-26-000123' });
  assert.equal(rows[1].form, '4/A');
});
