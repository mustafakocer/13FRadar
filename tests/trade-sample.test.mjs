import test from 'node:test';
import assert from 'node:assert/strict';
import { pickForm4s, pickReports, form4Lines, form4Url, compareAccession, tradeSampleIssue } from '../api/_lib/tradeSample.js';

const XML = `<SEC-DOCUMENT><TEXT><XML>
<ownershipDocument>
  <issuer><issuerCik>0000320193</issuerCik><issuerTradingSymbol>AAPL</issuerTradingSymbol></issuer>
  <nonDerivativeTable>
    <nonDerivativeTransaction>
      <securityTitle><value>Common Stock</value></securityTitle>
      <transactionDate><value>2026-10-01</value></transactionDate>
      <transactionCoding><transactionFormType>4</transactionFormType><transactionCode>S</transactionCode></transactionCoding>
      <transactionAmounts>
        <transactionShares><value>1,500.4</value></transactionShares>
        <transactionPricePerShare><value>250.1234</value><footnoteId id="F1"/></transactionPricePerShare>
        <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
      </transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>10000</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
    <nonDerivativeTransaction>
      <transactionDate><value>2026-10-02</value></transactionDate>
      <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>100</value></transactionShares><transactionPricePerShare><value>249</value></transactionPricePerShare></transactionAmounts>
      <postTransactionAmounts><sharesOwnedFollowingTransaction><value>10100</value></sharesOwnedFollowingTransaction></postTransactionAmounts>
    </nonDerivativeTransaction>
  </nonDerivativeTable>
  <derivativeTable><derivativeTransaction><transactionCoding><transactionCode>M</transactionCode></transactionCoding></derivativeTransaction></derivativeTable>
</ownershipDocument></XML></TEXT></SEC-DOCUMENT>`;

test('trade sample: a Form 4 read from its own XML, derivative lines left out', () => {
  assert.deepEqual(form4Lines(XML), [
    { k: 'S', d: '2026-10-01', s: 1500.4, p: 250.1234, o: 10000 },
    { k: 'P', d: '2026-10-02', s: 100, p: 249, o: 10100 },
  ]);
  assert.deepEqual(form4Lines('<html>no</html>'), []);
  assert.equal(form4Url('0000320193', '0000320193-26-000001'), 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001.txt');
  const ours = [{ k: 'S', d: '2026-10-01', s: 1500, p: 250.1234, o: 10000 }, { k: 'P', d: '2026-10-02', s: 100, p: 249, o: 10100 }];
  assert.equal(compareAccession(ours, form4Lines(XML)).status, 'match');
  assert.equal(compareAccession([{ ...ours[0], p: 260 }], form4Lines(XML)).status, 'differs');
});

test('trade sample: the same week draws the same filings, only recent ones with a purchase or a sale', () => {
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ a: `acc-${i}`, ci: '1', t: `T${i}`, n: 'X', f: '2026-10-14', k: i % 3 ? 'S' : 'A' });
  rows.push({ a: 'old', ci: '1', t: 'OLD', n: 'X', f: '2026-09-01', k: 'P' }, { a: 'sup', ci: '1', t: 'SUP', n: 'X', f: '2026-10-14', k: 'P', sb: 'x' });
  const a = pickForm4s(rows, { week: '2026-W42', now: '2026-10-15T00:00:00Z' });
  const b = pickForm4s(rows, { week: '2026-W42', now: '2026-10-15T00:00:00Z' });
  assert.equal(a.length, 10);
  assert.deepEqual(a.map((f) => f.acc), b.map((f) => f.acc));
  assert.ok(a.every((f) => f.rows.some((r) => r.k === 'S' || r.k === 'P')));
  assert.ok(!a.some((f) => f.acc === 'old' || f.acc === 'sup'));
  assert.notDeepEqual(pickForm4s(rows, { week: '2026-W43', now: '2026-10-15T00:00:00Z' }).map((f) => f.acc), a.map((f) => f.acc));

  const cg = [{ src: 'p1', m: 'A1', f: '2026-10-10', a: 'Apple', t: 'AAPL', k: 'buy', o: 'self', lo: 1001, hi: 15000, d: '2026-09-20' }, { src: 'p1', m: 'A1', f: '2026-10-10', a: 'MSFT', t: 'MSFT', k: 'sell', lo: 1001, hi: 15000, d: '2026-09-21' }, { src: 'p0', m: 'A1', f: '2026-08-01', a: 'Old', d: '2026-07-01' }];
  const reps = pickReports(cg, { week: '2026-W42', now: '2026-10-15T00:00:00Z' });
  assert.deepEqual(reps.map((r) => [r.src, r.rows.length]), [['p1', 2]]);

  const issue = tradeSampleIssue({
    week: '2026-W42',
    form4s: [{ filing: { acc: '0000320193-26-000001', cik: '320193', t: 'AAPL', n: 'Cook Tim', filed: '2026-10-14' }, check: compareAccession([{ k: 'S', d: '2026-10-01', s: 1500, p: 260, o: 10000 }], form4Lines(XML)) }, { filing: { acc: 'x', cik: '1', t: 'ZZ', n: 'Y', filed: '2026-10-14' }, error: 'HTTP 404' }],
    reports: reps,
    members: { A1: { n: 'Jane Doe', slug: 'jane-doe' } },
    mention: '@m',
  });
  assert.match(issue.title, /2026-W42/);
  assert.match(issue.body, /^@m /);
  assert.match(issue.body, /0 Form 4 tam uyuştu, 2 tanesinde fark var/);
  assert.match(issue.body, /❌ fiyat farklı/);
  assert.match(issue.body, /congress\/jane-doe/);
  assert.equal((issue.body.match(/- \[ \]/g) || []).length, 3);
});
