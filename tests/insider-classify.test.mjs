// Transaction categories and signal levels, on real rows from the dataset
// (tests/fixtures/insider-cases.json). Every case here was on the live site
// labelled "Güçlü sinyal" or listed as a buy/sell before this change.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';
import { categorize, classify, isEntityName } from '../api/_lib/insiderClassify.js';
import { signalLevel } from '../api/_lib/insiderSignal.js';
import { SIGNAL } from '../api/_lib/insiderSignalConfig.js';

const cases = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'insider-cases.json'), 'utf8'));

test('FLY: a CFO exercising options at $0.49 is an option exercise with no signal', () => {
  const r = cases.FLY_M_cfo_exercise;
  assert.equal(r.k, 'M');
  assert.equal(categorize(r), 'exercise');
  assert.equal(classify(r).openMarket, false, 'so it has no return and is hidden from the default feed');
  assert.equal(signalLevel(r).level, 'none');
  assert.equal(categorize(cases.CORT_M_exercise), 'exercise');
});

test('DRI: $0 share awards are "Hisse ödülü" and never open-market', () => {
  // the stored DRI lines are coded M at $0 (restricted units vesting)…
  const vest = cases.DRI_M_zero_price;
  assert.equal(categorize(vest), 'exercise');
  assert.equal(classify(vest).zero_price, true);
  assert.equal(signalLevel(vest).level, 'none');
  // …and the same line coded A, as the task describes it, is an award
  const award = { ...vest, k: 'A' };
  assert.equal(categorize(award), 'award');
  assert.equal(classify(award).openMarket, false);
  assert.equal(signalLevel(award).level, 'none');
});

test('LIFE: a 10b5-1 planned trade carries no signal', () => {
  const r = cases.LIFE_C_10b5_1;
  assert.equal(categorize(r), 'conversion');
  assert.equal(classify(r).plan_trade, true);
  assert.equal(signalLevel(r).level, 'none');
  // the plan flag alone is enough, even on a large CEO open-market buy
  const plannedBuy = { ...cases.TFC_ceo_1m, p5: 1 };
  assert.deepEqual([signalLevel(plannedBuy).level, signalLevel(plannedBuy).why], ['none', 'plan']);
  // and so is a plan footnote without the checkbox
  assert.equal(signalLevel({ ...cases.TFC_ceo_1m, pn: 1 }).level, 'none');
});

test('Horizon Kinetics buying 1 TPL share: no signal, marked as a large holder (fund)', () => {
  const r = cases.TPL_horizon_1_share;
  assert.equal(r.s, 1);
  const c = classify(r);
  assert.equal(c.category, 'open_buy');
  assert.equal(c.fund_insider, true);
  assert.equal(c.ten_pct_owner_only, true);
  const s = signalLevel(r);
  assert.deepEqual([s.level, s.why, s.largeHolder], ['none', 'small', true]);
});

test('Mink Brook: a fund can never be more than weak, whatever it buys', () => {
  const r = cases.DLHC_mink_brook_316;
  assert.equal(signalLevel(r).level, 'none', '$1,241 is under the floor');
  const big = { ...r, s: 1_000_000, v: 3_925_800, oc: 150 };
  const s = signalLevel(big);
  assert.deepEqual([s.level, s.why, s.largeHolder], ['weak', 'large_holder_cap', true]);
});

test('TFC: the CEO buying $1.0M is strong', () => {
  const r = cases.TFC_ceo_1m;
  assert.ok(r.v >= 1_000_000);
  const s = signalLevel(r);
  assert.deepEqual([s.level, s.why, s.role], ['strong', 'top_value', 'ceo']);
});

test('AAPL Newstead: shares withheld for tax are "Vergi kesintisi"', () => {
  const r = cases.AAPL_newstead_F;
  assert.equal(categorize(r), 'tax');
  assert.equal(classify(r).side, 'sell');
  assert.equal(signalLevel(r).level, 'none');
});

test('TSM: thirty small officer buys carry no signal; the CEO\'s $11K one is weak', () => {
  const rows = cases.TSM_small_buys;
  assert.equal(rows.length, 31);
  const small = rows.filter((r) => r.v < SIGNAL.minValue);
  assert.equal(small.length, 30);
  for (const r of small) assert.equal(signalLevel(r).level, 'none', `${r.n} $${r.v}`);
  const ceo = rows.find((r) => r.v >= SIGNAL.minValue);
  assert.deepEqual([ceo.r, signalLevel(ceo).level], ['ceo', 'weak'], 'a CEO under $100K is not strong');
});

test('the rest of the ladder: medium by role and size, or by a big increase in holding', () => {
  const base = { k: 'P', p: 20, r: 'director', n: 'Doe Jane', t: 'X' };
  assert.equal(signalLevel({ ...base, s: 1000, v: 20_000 }).level, 'weak');
  assert.equal(signalLevel({ ...base, s: 3000, v: 60_000 }).level, 'medium');
  assert.equal(signalLevel({ ...base, s: 1000, v: 20_000, oc: 25 }).why, 'own_increase');
  assert.equal(signalLevel({ ...base, s: 15000, v: 300_000, oc: 12 }).level, 'strong', 'a director, $300K, +12%');
  assert.equal(signalLevel({ ...base, s: 15000, v: 300_000, oc: 5 }).level, 'medium', 'the same without the increase');
  assert.equal(signalLevel({ ...base, s: 15000, v: 300_000, o: 15000 }).level, 'strong', 'a new position is an increase');
  assert.equal(signalLevel({ ...base, ti: 'Executive Vice President', r: 'officer', s: 6000, v: 120_000 }).level, 'medium', 'a vice president is not "President"');
  assert.equal(signalLevel({ ...base, ti: 'Chairman', s: 6000, v: 120_000 }).level, 'strong');
  assert.equal(signalLevel({ ...base, k: 'S', s: 50000, v: 1_000_000 }).level, 'none', 'sales are never rated');
  assert.equal(signalLevel({ ...base, p: 0, v: 0, s: 5000 }).why, 'not_open_buy', 'a P with no price is not an open-market buy');
});

test('entity names: funds and companies, not people', () => {
  for (const n of ['HORIZON KINETICS ASSET MANAGEMENT LLC', 'Mink Brook Asset Management LLC', 'Berkshire Hathaway Inc', 'Smith Family Trust', 'ABC Capital Partners, L.P.'])
    assert.ok(isEntityName(n), n);
  for (const n of ['Lyons Michael P.', 'Newstead Jennifer', 'Colis Peter George', 'Wei Che-Chia', 'Cooper Anderson'])
    assert.ok(!isEntityName(n), n);
});

// ---- the feed, through the real handler ------------------------------------------

import os from 'node:os';
import { resetServedCache } from '../api/_lib/insiderStore.js';
import { buildTeaser } from '../api/_lib/insiderTeaser.js';

async function feedOver(rows, query) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ins-'));
  fs.writeFileSync(path.join(dir, 'insiders.json'), JSON.stringify({ updatedAt: '2026-09-19T04:00:00Z', rows, companies: {} }));
  process.env.INSIDER_DATA_DIR = dir;
  resetServedCache();
  try {
    // the Pro feed, past the sign-in check the tests cannot pass
    const { answer } = await import('../api/_handlers/insider-feed.js');
    return await answer(query, { free: false });
  } finally {
    delete process.env.INSIDER_DATA_DIR;
    resetServedCache();
  }
}

const recent = (r) => ({ ...r, d: '2026-09-17', f: '2026-09-18' });
const mixed = [
  recent(cases.TFC_ceo_1m),
  recent(cases.FLY_M_cfo_exercise),
  recent(cases.DRI_M_zero_price),
  recent({ ...cases.DRI_M_zero_price, k: 'A', a: 'AWARD-1' }),
  recent(cases.AAPL_newstead_F),
  recent(cases.LIFE_C_10b5_1),
  recent(cases.TPL_horizon_1_share),
  recent({ ...cases.TFC_ceo_1m, k: 'S', a: 'SELL-1', n: 'Seller Sam', r: 'director' }),
];

test('the subtitle says "open-market buys and sales only" — and the default feed is exactly that', async () => {
  const i18n = fs.readFileSync(path.join(root, 'client', 'src', 'i18n.jsx'), 'utf8');
  assert.match(i18n, /'ins\.note': '[^']*yalnızca açık piyasa alım \(P\) ve satımları \(S\)/, 'the Turkish note promises P and S by default');
  assert.match(i18n, /'ins\.note': '[^']*only open-market purchases \(P\) and sales \(S\)/);
  const buys = await feedOver(mixed, { tab: 'latest' });
  const sells = await feedOver(mixed, { tab: 'sells' });
  assert.deepEqual([...new Set(buys.rows.map((r) => r.category))], ['open_buy']);
  assert.deepEqual([...new Set(sells.rows.map((r) => r.category))], ['open_sell']);
  assert.ok(!buys.rows.some((r) => r.ticker === 'DRI'), 'the $0 DRI lines are not in the default feed');
  // with other types shown, each is labelled by its category
  const all = await feedOver(mixed, { tab: 'latest', types: 'all' });
  assert.ok(all.total > buys.total);
  assert.deepEqual([...new Set(all.rows.map((r) => r.category))].sort(), ['award', 'conversion', 'exercise', 'open_buy']);
});

test('returns and signal levels only where they mean something', async () => {
  const all = await feedOver(mixed, { tab: 'latest', types: 'all' });
  for (const r of all.rows) {
    if (r.category !== 'open_buy') {
      assert.equal(r.ret, null, `${r.ticker} ${r.category}: no return`);
      assert.equal(r.signal.level, 'none');
    }
  }
  const tfc = all.rows.find((r) => r.ticker === 'TFC');
  assert.equal(tfc.signal.level, 'strong');
  assert.equal('pe' in tfc, false, 'the empty F/K column is gone');
  const tpl = all.rows.find((r) => r.ticker === 'TPL');
  assert.deepEqual([tpl.signal.level, tpl.largeHolder, tpl.hitRate], ['none', true, null], 'a fund: large holder, no İsabet');
});

test('home page and /insiders headline numbers still come from one function and agree', async () => {
  const feed = await feedOver(mixed, { tab: 'latest' });
  const teaser = buildTeaser(mixed, {}, {}, Date.parse('2026-09-19'));
  assert.equal(feed.stats.buyCount, teaser.pulse.buyCount);
  assert.equal(feed.stats.buyValue, teaser.pulse.buyValue);
  assert.equal(feed.stats.sellCount, teaser.pulse.sellCount);
  assert.equal(feed.stats.buyCount, 2, 'TFC and the one-share TPL buy; no exercise, award or conversion');
});
