// Data-correctness rules found by the October 2026 insider audit:
//   duplicate filings (the same trade under two accessions), mirror P/S
//   pairs inside one filing, CEO/CFO titles that are not the issuer's,
//   mutual-fund tickers taken for open-market stocks, and prices that failed
//   the market check reaching the ranked lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { currentRows, markDuplicates, markMirrors, markRows, markSuperseded } from '../api/_lib/insiderStore.js';
import { classifyRole, daySummary, isSubsidiaryTitle, refreshRole } from '../api/_lib/insiderModel.js';
import { categorize, classify, isMutualFundTicker } from '../api/_lib/insiderClassify.js';
import { buildClusters } from '../api/_lib/insiderCluster.js';
import { buildPennyBoard, buildTeaser } from '../api/_lib/insiderTeaser.js';

const row = (o) => ({ t: 'EXMP', ci: '0000111111', n: 'Doe Jane', r: 'director', d: '2026-09-16', f: '2026-09-17', k: 'S', s: 9079675, p: 205.26, v: 1863694091, a: 'A-1', li: 0, ...o });

// ------------------------------------------------------------ duplicates
test('the same sale filed twice the same day (FANG / SGF FANG Holdings) keeps the earlier accession', () => {
  const first = row({ n: 'SGF FANG Holdings, LP', ow: '0002080063', a: '0001140361-26-037009' });
  const copy = row({ n: 'SGF FANG Holdings, LP', ow: '0002080063', a: '0001140361-26-037010' });
  const rows = [copy, first];
  assert.equal(markDuplicates(rows), 1);
  assert.equal(copy.sb, first.a);
  assert.equal(copy.dp, 1);
  assert.equal(first.sb, undefined);
  assert.deepEqual(currentRows(rows), [first]);
  // the day's totals count it once
  assert.equal(daySummary(rows).sellValue, 1863694091);
});

test('a buy refiled months later as a plain 4 (AVR / L1 Capital) is a duplicate of the first filing', () => {
  const feb = row({ n: 'L1 Capital Pty Ltd', k: 'P', d: '2026-01-22', f: '2026-02-09', s: 5000000, p: 5.75, v: 28750000, a: '0001079973-26-000185' });
  const jul = row({ n: 'L1 CAPITAL PTY LTD', k: 'P', d: '2026-01-22', f: '2026-07-28', s: 5000000, p: 5.75, v: 28750000, a: '0001817646-26-000013' });
  assert.equal(markDuplicates([jul, feb]), 1, 'names match regardless of case and punctuation');
  assert.equal(jul.sb, feb.a);
});

test('duplicates are matched conservatively', () => {
  // two identical lots inside ONE filing are two lots
  const lots = [row({ a: 'X', li: 0 }), row({ a: 'X', li: 1 })];
  assert.equal(markDuplicates(lots), 0);
  // a copy with two lots against an original with one loses one line
  const orig = row({ a: 'O', f: '2026-09-17' });
  const c1 = row({ a: 'C', f: '2026-09-18', li: 0 });
  const c2 = row({ a: 'C', f: '2026-09-18', li: 1 });
  assert.equal(markDuplicates([orig, c1, c2]), 1);
  assert.equal(currentRows([orig, c1, c2]).length, 2);
  // two owner CIKs are two people, whatever the names
  assert.equal(markDuplicates([row({ a: 'P1', ow: '1' }), row({ a: 'P2', ow: '2' })]), 0);
  // a different price, share count, date or issuer is a different trade
  assert.equal(markDuplicates([row({ a: 'Q1' }), row({ a: 'Q2', p: 205.25 })]), 0);
  assert.equal(markDuplicates([row({ a: 'Q1' }), row({ a: 'Q2', s: 1 })]), 0);
  assert.equal(markDuplicates([row({ a: 'Q1' }), row({ a: 'Q2', d: '2026-09-15' })]), 0);
  assert.equal(markDuplicates([row({ a: 'Q1' }), row({ a: 'Q2', ci: '0000222222' })]), 0);
  // grants and withholding are left alone (no open-market price)
  assert.equal(markDuplicates([row({ a: 'G1', k: 'A', p: 0 }), row({ a: 'G2', k: 'A', p: 0 })]), 0);
});

test('duplicate marks are recomputed with the 4/A marks and never erase an amendment', () => {
  const orig = row({ a: 'ORIG', ow: '9', f: '2026-09-17' });
  const amend = row({ a: 'AMND', ow: '9', fa: '4/A', f: '2026-09-20' });
  const dup = row({ a: 'DUP', ow: '9', f: '2026-09-25', k: 'S', s: 5, p: 1, v: 5 });
  const dupOf = row({ a: 'DUP0', ow: '9', f: '2026-09-18', k: 'S', s: 5, p: 1, v: 5 });
  const rows = [orig, amend, dup, dupOf];
  for (let i = 0; i < 2; i++) {
    markSuperseded(rows);
    markDuplicates(rows);
    assert.equal(orig.sb, 'AMND');
    assert.equal(orig.dp, undefined);
    assert.equal(amend.sb, undefined, 'the amendment is the current line, not a duplicate of the original');
    assert.equal(dup.sb, 'DUP0');
  }
});

// ------------------------------------------------------------ mirror pairs
test('a P and an S of the same shares and price in one filing (PAMT / Moroun) are a transfer, not two trades', () => {
  const buy = row({ t: 'PAMT', n: 'MOROUN MATTHEW T', k: 'P', d: '2026-09-03', f: '2026-09-05', s: 3268000, p: 9.555, v: 31225740, a: '0001683168-26-007021', li: 0 });
  const sell = { ...buy, k: 'S', li: 1 };
  const other = { ...buy, k: 'S', li: 2, s: 100, v: 955 };
  const rows = [buy, sell, other];
  assert.equal(markMirrors(rows), 2);
  assert.equal(buy.mx, 1);
  assert.equal(sell.mx, 1);
  assert.equal(other.mx, undefined);
  assert.equal(categorize(buy), 'other');
  assert.equal(categorize(sell), 'other');
  assert.equal(classify(buy).mirror_trade, true);
  const s = daySummary(rows);
  assert.equal(s.buyCount, 0);
  assert.equal(s.sellCount, 1);
  // the same pair in two different filings is not a mirror
  assert.equal(markMirrors([buy, { ...sell, a: 'OTHER' }]), 0);
  assert.equal(buy.mx, undefined);
});

// ------------------------------------------------------------ roles
test('Treasurer alone is not the CFO; a CFO who is also Treasurer still is', () => {
  const role = (title) => classifyRole({ title, isOfficer: true });
  for (const t of ['Treasurer', 'VP and Treasurer', 'Vice President  & Treasurer', 'Assistant Treasurer', 'SVP, Treasurer & Tax', 'VP, Controller & Treasurer', 'Secretary and Treasurer'])
    assert.equal(role(t), 'officer', t);
  for (const t of ['CFO and Treasurer', 'SEVP, Treasurer and CFO', 'Chief Financial Off./Treasurer', 'E.V.P., C.F.O. & Treasurer', 'Treasurer and PFO', 'EVP, CFO, CAO & Treasurer'])
    assert.equal(role(t), 'cfo', t);
  assert.equal(role('President & C.E.O.'), 'ceo');
});

test('a subsidiary, division or region CEO/CFO is not the issuer\'s', () => {
  const cases = [
    ['CEO of Merchants Capital', { ticker: 'MBIN', name: 'Merchants Bancorp' }, 'officer'],
    ['PRESIDENT/CEO OF AMPLEX', { ticker: 'OMCC', name: '' }, 'officer'],
    ['EVP & CEO of Hawaiian Airlines', { ticker: 'ALK', name: 'ALASKA AIR GROUP, INC.' }, 'officer'],
    ['KFC Division CEO', { ticker: 'YUM', name: 'YUM BRANDS INC' }, 'officer'],
    ['CEO, GMPD Segment', { ticker: 'CAH', name: 'CARDINAL HEALTH INC' }, 'officer'],
    ['President & CEO, subsidiary', { ticker: 'TDS', name: 'TELEPHONE & DATA SYSTEMS INC /DE/' }, 'officer'],
    ['Centennial Bank CEO', { ticker: 'HOMB', name: 'HOME BANCSHARES INC' }, 'officer'],
    ['EVP, CFO - Bank', { ticker: 'FFIN', name: 'FIRST FINANCIAL BANKSHARES INC' }, 'officer'],
    ['CFO of IM8 (US) LLC', { ticker: 'PRE', name: 'Prenetics Global Ltd' }, 'officer'],
    // …but the issuer itself, named any way, is
    ['Pres. & CEO of NCLH', { ticker: 'NCLH', name: 'Norwegian Cruise Line Holdings Ltd.' }, 'ceo'],
    ['President/CEO of UCC', { ticker: 'UWHR', name: 'UWHARRIE CAPITAL CORP' }, 'ceo'],
    ['Chairman of the Board and CEO', { ticker: 'MTB', name: 'M&T BANK CORP' }, 'ceo'],
    ['CEO & Chairman of BOD', { ticker: 'CPAY', name: 'CORPAY, INC.' }, 'ceo'],
    ['President & CEO ASRV & Bank', { ticker: 'ASRV', name: 'AMERISERV FINANCIAL INC /PA/' }, 'ceo'],
    ['Pres/CEO/Dir of Company & Bank', { ticker: 'CMTV', name: 'COMMUNITY BANCORP /VT' }, 'ceo'],
    ['CFO and Head of International', { ticker: 'WRD', name: 'WeRide Inc.' }, 'cfo'],
    ['EVP of Finance & CFO', { ticker: 'IPST', name: '' }, 'cfo'],
  ];
  for (const [title, issuer, want] of cases) assert.equal(classifyRole({ title, isOfficer: true }, issuer), want, title);
  assert.equal(isSubsidiaryTitle('Chief Executive Officer', {}), false);
});

test('stored roles are re-read from the title, falling back to the form\'s relationship boxes', () => {
  assert.equal(refreshRole({ r: 'cfo', ti: 'VP & Treasurer' }, null), 'officer');
  assert.equal(refreshRole({ r: 'cfo', ti: 'Treasurer' }, { dr: 1 }), 'director');
  assert.equal(refreshRole({ r: 'ceo', ti: 'CEO of Merchants Capital', t: 'MBIN' }, { of: 1 }, { ticker: 'MBIN', name: 'Merchants Bancorp' }), 'officer');
  assert.equal(refreshRole({ r: 'cfo', ti: 'CFO and Treasurer' }, null), 'cfo');
  assert.equal(refreshRole({ r: 'director', ti: null }, null), 'director');
  // markRows applies it to the stored rows, and a second run changes nothing
  const rows = [row({ r: 'cfo', ti: 'VP and Treasurer', k: 'P', a: 'R1' })];
  assert.equal(markRows(rows).roles, 1);
  assert.equal(rows[0].r, 'officer');
  assert.equal(markRows(rows).roles, 0);
});

// ------------------------------------------------------------ mutual funds
test('a mutual-fund ticker (five letters ending in X) has no open market', () => {
  for (const t of ['LNBIX', 'PBLSX', 'CCLFX', 'MUNEX', 'PMPEX']) assert.equal(isMutualFundTicker(t), true, t);
  for (const t of ['AAPL', 'XOM', 'NVDAX1', 'BRK.B', 'GOOGL', 'X']) assert.equal(isMutualFundTicker(t), false, t);
  const buy = row({ t: 'PMPEX', k: 'P', p: 17.44, s: 1000, v: 17440 });
  assert.equal(categorize(buy), 'other');
  assert.equal(classify(buy).not_traded, true);
  // three officers buying the fund at NAV are not a cluster
  const lines = ['A', 'B', 'C'].map((n, i) => ({ ...buy, n, r: 'officer', ti: 'Officer', a: `F${i}`, v: 50000 }));
  assert.equal(buildClusters(lines).clusters.length, 0);
});

// ------------------------------------------------------------ ranked lists
test('a price that failed the market check never takes a ranked slot (penny board, C-suite, penny list)', () => {
  const base = { ci: '1', d: '2026-10-01', f: '2026-10-02', k: 'P', o: 1e6, oc: 10, li: 0 };
  const rows = [
    // SLBT: the aggregate in the price column, flagged by the build
    { ...base, t: 'SLBT', n: 'Wang Ching-Dong', r: 'ceo', ti: 'Chief Executive Officer', s: 4545306, p: 0.5, v: 2272653, a: 'S1', pu: 1 },
    // GGR: an issuer purchase at $2.48 against a $2.99 close (off market)
    { ...base, t: 'GGR', n: 'Yin Chung-Yao', r: 'director', s: 10692681, p: 2.48, v: 26517849, a: 'G1', fx: { cu: 'USD', ar: 1, ok: 1, off: -17.1 } },
    { ...base, t: 'GOOD', n: 'Real Buyer', r: 'ceo', ti: 'CEO', s: 100000, p: 2, v: 200000, a: 'OK1' },
  ];
  const board = buildPennyBoard(rows, {}, {}, '2026-10-02');
  assert.deepEqual(board.rows.map((r) => r.t), ['GOOD']);
  assert.deepEqual(board.top.buys.map((r) => r.t), ['GOOD']);
  assert.equal(board.stats.buyValue, 200000);
  assert.equal(board.stats.priceExcluded, 2);
  const t = buildTeaser(rows, {}, {}, Date.parse('2026-10-02'));
  assert.deepEqual(t.signals.csuite.map((r) => r.t), ['GOOD']);
  assert.deepEqual(t.signals.penny.map((r) => r.t), ['GOOD']);
});
