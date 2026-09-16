import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

// The per-security roll-up behind the stock page, the ownership rankings and
// the screener. Runs the real aggregation over the offline filer fixtures.
process.env.SEC_FIXTURE_DIR =
  process.env.SEC_FIXTURE_DIR || path.join(process.cwd(), 'tests', 'fixtures', 'sec');
process.env.CONSENSUS_CIKS = '0001067983,0001336528,0001649339';

const { build } = await import('../api/_lib/consensusBuild.js');
const consensus = await build();
const { stocks, options } = consensus;

test('every curated fund in the panel is aggregated', () => {
  assert.equal(consensus.managers.length, 3);
  assert.ok(stocks.length > 0);
});

test('stocks are ranked by holder count, and the rank column matches the order', () => {
  for (let i = 1; i < stocks.length; i++) {
    const a = stocks[i - 1];
    const b = stocks[i];
    assert.ok(
      a.holderCount > b.holderCount || (a.holderCount === b.holderCount && a.totalValue >= b.totalValue),
      `${a.ticker || a.cusip} should not rank above ${b.ticker || b.cusip}`
    );
  }
  assert.deepEqual(
    stocks.map((s) => s.rank),
    stocks.map((_, i) => i + 1)
  );
});

test('the activity breakdown adds up to the buyer and seller counts', () => {
  for (const s of stocks) {
    assert.equal(s.buyers, s.newBuyers + s.adders, `${s.ticker || s.cusip} buyers`);
    assert.equal(s.sellers, s.reducers + s.exiters, `${s.ticker || s.cusip} sellers`);
    assert.equal(s.netValue, s.buyValue - s.sellValue, `${s.ticker || s.cusip} net`);
  }
});

test('holders carry their own position, activity and quarter-over-quarter change', () => {
  const kinds = new Set(['new', 'add', 'reduce', 'hold']);
  let sawNew = false;
  let sawAdd = false;
  for (const s of stocks) {
    assert.ok(s.holders.length <= 25, 'holder list is capped');
    assert.equal(s.holders.length, Math.min(s.holderCount, 25));
    for (const h of s.holders) {
      assert.ok(kinds.has(h.activity), `${h.activity} is not an activity`);
      assert.ok(h.shares > 0 && h.value > 0);
      if (h.activity === 'new') {
        sawNew = true;
        assert.equal(h.change, null, 'a brand new position has nothing to compare against');
      }
      if (h.activity === 'add') {
        sawAdd = true;
        assert.ok(h.change > 0, 'an add reports a positive share change');
      }
      if (h.activity === 'reduce') assert.ok(h.change < 0);
    }
    // sorted by conviction, and maxWeight is the top of that list
    const weights = s.holders.map((h) => h.weight);
    assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
    assert.equal(s.maxWeight, weights[0]);
    assert.ok(s.maxWeight >= s.avgWeight - 0.01);
  }
  assert.ok(sawNew && sawAdd, 'fixtures should exercise both new buys and adds');
});

test('a fund holding both the common and a put on it keeps the two apart', () => {
  const put = options.find((o) => o.ticker === 'NVDA' && o.putCall === 'Put');
  assert.ok(put, 'the put line is aggregated');
  assert.equal(put.totalShares, 200000);

  const common = stocks.find((s) => s.ticker === 'NVDA');
  // Berkshire 5.0M + Scion 0.5M — the 0.2M put must not be folded in
  assert.equal(common.totalShares, 5500000);
  assert.equal(common.holderCount, 2);
  assert.ok(
    !stocks.some((s) => s.putCall),
    'no option line leaks into the equity table'
  );
});

test('the totals equal the sum of the holders they are built from', () => {
  for (const s of stocks) {
    if (s.holderCount > 25) continue; // tail is trimmed off the stored list
    const shares = s.holders.reduce((t, h) => t + h.shares, 0);
    const value = s.holders.reduce((t, h) => t + h.value, 0);
    assert.equal(shares, s.totalShares, `${s.ticker || s.cusip} shares`);
    assert.ok(Math.abs(value - s.totalValue) <= s.holders.length, `${s.ticker || s.cusip} value`);
  }
});

test('the lists the consensus page already shipped keep their shape', () => {
  for (const row of consensus.mostHeld) assert.ok(row.holders.length <= 6);
  assert.ok(consensus.topBought.every((r) => r.netValue > 0));
  assert.ok(consensus.topSold.every((r) => r.netValue < 0));
});
