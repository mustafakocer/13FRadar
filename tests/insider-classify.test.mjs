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
  // A4: the same day, sell $ and split, rendered by one component on both pages
  for (const k of ['day', 'sellValue', 'sellShare']) assert.equal(feed.stats[k], teaser.pulse[k], k);
  assert.ok(teaser.pulse.day, 'the date travels with the numbers');
  const { pulsePercents } = await import('../client/src/lib/insiderPulse.js');
  assert.deepEqual(pulsePercents(feed.stats), pulsePercents(teaser.pulse));
  const pct = pulsePercents({ sellShare: 85.6 });
  assert.equal(pct.buy + pct.sell, 100);
  for (const page of ['Home.jsx', 'Insiders.jsx']) {
    const src = fs.readFileSync(path.join(root, 'client', 'src', 'pages', page), 'utf8');
    assert.match(src, /<InsiderDaySummary summary=\{(pulse|stats)\}/, `${page} renders the shared block`);
    assert.doesNotMatch(src, /buyPct|sellShare \?\? 50/, `${page} computes no percentages of its own`);
  }
});

test('/insiders reads the home page\'s stored day summary: one result, not two conversions', async () => {
  const teaser = buildTeaser(mixed, {}, {}, Date.parse('2026-09-19'));
  // the night's conversion counted one more buy than a request-time one would
  const stored = { ...teaser.pulse, buyCount: teaser.pulse.buyCount + 1, buyValue: teaser.pulse.buyValue + 1234, fxExcluded: 3 };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'teaser-')), 'insiders-teaser.json');
  fs.writeFileSync(file, JSON.stringify({ pulse: stored }));
  process.env.INSIDER_TEASER_FILE = file;
  const { resetPulseCache } = await import('../api/_handlers/insider-feed.js');
  resetPulseCache();
  try {
    const feed = await feedOver(mixed, { tab: 'latest' });
    for (const k of ['day', 'buyCount', 'buyValue', 'sellCount', 'sellValue', 'sellShare', 'fxExcluded']) assert.equal(feed.stats[k], stored[k], k);
    // another day in the file: the live numbers
    fs.writeFileSync(file, JSON.stringify({ pulse: { ...stored, day: '2026-01-02' } }));
    resetPulseCache();
    const other = await feedOver(mixed, { tab: 'latest' });
    assert.equal(other.stats.buyCount, teaser.pulse.buyCount);
  } finally {
    delete process.env.INSIDER_TEASER_FILE;
    resetPulseCache();
  }
});

test('level labels describe the trade, promise nothing, and "none" shows no label', () => {
  const i18n = fs.readFileSync(path.join(root, 'client', 'src', 'i18n.jsx'), 'utf8');
  const val = (key) => [...i18n.matchAll(new RegExp(`'${key.replace('.', '\\.')}': '([^']*)'`, 'g'))].map((m) => m[1]);
  assert.deepEqual(val('ins.level.strong'), ['Öne çıkan alım', 'Prominent buy']);
  assert.deepEqual(val('ins.level.medium'), ['Kayda değer alım', 'Notable buy']);
  assert.deepEqual(val('ins.level.weak'), ['Küçük alım', 'Small buy']);
  assert.deepEqual(val('ins.level.none'), ['', '']);
  assert.match(i18n, /'ins\.levelDisclaimer': 'Bu etiket işlemin büyüklüğünü ve alan kişinin görevini özetler; gelecekteki getiriyi öngörmez\.'/);
  const page = fs.readFileSync(path.join(root, 'client', 'src', 'pages', 'Insiders.jsx'), 'utf8');
  assert.match(page, /level !== 'none' &&/, 'no badge for a buy that rates none');
  assert.match(page, /ins\.levelDisclaimer/, 'the disclaimer is in the tooltip');
});

// ---- review fixes (PR #41) ---------------------------------------------------------

import { priceMismatch, checkPriceUnits, hitRate as hitRateOf, buysByPerson } from '../api/_lib/insiderOutcome.js';
import { splitFactor, sinceTrade } from '../api/_lib/splitAdjust.js';

const closes = (day, close) => [{ date: day, close }, { date: '2026-12-31', close }];

test('1) a form price 25%+ away from the day\'s close is flagged: no return, no İsabet, at most "Küçük alım"', async () => {
  // CEMEX: $17.28 on the form, $9.71 at the close — pesos read as dollars
  const cx = { t: 'CX', n: 'Zambrano Lozano Rogelio', r: 'ceo', ti: 'CEO', k: 'P', d: '2026-09-25', f: '2026-09-25', s: 400800, p: 17.2812, v: 6_926_305, a: 'CX-1', li: 0, o: 5_000_000 };
  assert.deepEqual(priceMismatch(cx, closes('2026-09-25', 9.71), {}).ratio, 1.78);
  assert.equal(priceMismatch({ ...cx, p: 9.9 }, closes('2026-09-25', 9.71), {}), false, 'within 25%: fine');
  const flagged = checkPriceUnits([cx], () => closes('2026-09-25', 9.71));
  assert.equal(flagged.length, 1);
  assert.equal(cx.pu, 1);
  assert.equal(signalLevel(cx).level, 'weak', 'a $6.9M CEO buy, but the amount cannot be trusted');
  assert.equal(signalLevel(cx).why, 'price_unverified');
  assert.deepEqual(hitRateOf(cx, buysByPerson([cx])), { unverified: true });
  assert.equal(sinceTrade(cx, 9.71, {}), null, 'no return');
  const feed = await feedOver([{ ...cx, d: '2026-09-17', f: '2026-09-18' }], { tab: 'latest' });
  assert.deepEqual([feed.rows[0].ret, feed.rows[0].priceUnverified], [null, true]);
});

test('1b) a split is not a currency problem, and not a −75% loss', () => {
  const splits = { CRWD: [{ date: '2026-07-02', ratio: 4 }] };
  const buy = { t: 'CRWD', k: 'P', d: '2026-06-01', p: 400, s: 10, v: 4000 };
  assert.equal(splitFactor('CRWD', '2026-06-01', splits), 4);
  assert.equal(splitFactor('CRWD', '2026-08-01', splits), 1, 'a split before the trade does not count');
  assert.equal(priceMismatch(buy, closes('2026-06-01', 100), splits), false, 'split-adjusted closes match the adjusted price');
  assert.equal(sinceTrade(buy, 110, splits), 10, '$400 pre-split is $100 today: +10%, not −72.5%');
});

test('2) fund status comes from the form: people who are 10% owners are not funds', () => {
  const white = { n: 'White Parker', r: 'owner10', k: 'P', p: 8.9, s: 538, v: 4788, t: 'DFDV' };
  const c = classify(white);
  assert.deepEqual([c.fund_insider, c.ten_pct_owner_only], [false, true]);
  assert.equal(signalLevel(white).holder, 'owner10', '"Büyük ortak (%10+)", not "(fon)"');
  assert.equal(classify({ n: 'HOLDING FRANK B JR', r: 'officer', ti: 'EVP' }).fund_insider, false, 'Mr Holding is an officer');
  assert.equal(classify({ n: 'HOLDING FRANK B JR', r: 'director' }).fund_insider, false);
  for (const n of ['LIBERTY MUTUAL INSURANCE CO', 'FHMLS X, L.P.', 'GOULD INVESTORS L P', 'CANTOR FITZGERALD, L. P.', 'BERKSHIRE HATHAWAY INC'])
    assert.equal(classify({ n, r: 'owner10' }).fund_insider, true, n);
  assert.equal(classify({ n: 'Artal Group S.A.', r: 'officer', ti: 'See remarks' }).fund_insider, true, 'a legal form is never a person');
});

test('3) the level is judged on the filing total, and the page says so', async () => {
  // White Parker's filing: $84,780 + $4,788 — the $4,788 line is not a "small buy" on its own
  const lines = [
    { n: 'White Parker', r: 'owner10', t: 'DFDV', k: 'P', a: 'DFDV-1', li: 0, s: 9462, p: 8.96, v: 84780, o: 9462, d: '2026-09-17', f: '2026-09-18' },
    { n: 'White Parker', r: 'owner10', t: 'DFDV', k: 'P', a: 'DFDV-1', li: 1, s: 538, p: 8.9, v: 4788, o: 10000, d: '2026-09-17', f: '2026-09-18' },
    // an officer's $6K line inside a $60K filing: "Kayda değer alım", total shown
    { n: 'Kang Daniel', r: 'officer', ti: 'Chief Strategy Officer', t: 'DFDV', k: 'P', a: 'DFDV-2', li: 0, s: 6000, p: 9, v: 54000, o: 20000, d: '2026-09-17', f: '2026-09-18' },
    { n: 'Kang Daniel', r: 'officer', ti: 'Chief Strategy Officer', t: 'DFDV', k: 'P', a: 'DFDV-2', li: 1, s: 700, p: 9, v: 6300, o: 20700, d: '2026-09-17', f: '2026-09-18' },
  ];
  const feed = await feedOver(lines, { tab: 'latest' });
  const small = feed.rows.find((r) => r.value === 4788);
  assert.deepEqual([small.signal.value, small.signal.lines, small.holder], [89568, 2, 'owner10']);
  const kang = feed.rows.find((r) => r.value === 6300);
  assert.deepEqual([kang.signal.level, kang.signal.value, kang.signal.lines], ['medium', 60300, 2]);
  const page = fs.readFileSync(path.join(root, 'client', 'src', 'pages', 'Insiders.jsx'), 'utf8');
  assert.match(page, /sig\.lines > 1 \? .*ins\.filingTotal/, 'the tooltip names the filing total when the level comes from it');
  assert.match(fs.readFileSync(path.join(root, 'client', 'src', 'i18n.jsx'), 'utf8'), /'ins\.filingTotal': 'Bu bildirimde toplam alım: \{v\}/);
});

test('4) the /insiders card is named for what it shows, and the higher label comes first', async () => {
  const i18n = fs.readFileSync(path.join(root, 'client', 'src', 'i18n.jsx'), 'utf8');
  assert.match(i18n, /'ins\.highConviction': 'Son Günün Yönetici ve Küme Alımları'/);
  assert.ok(!/'ins\.highConviction': 'Öne Çıkan Alımlar'/.test(i18n), 'no longer the name of the top level');
  const day = { d: '2026-09-17', f: '2026-09-18', k: 'P', p: 10 };
  const feed = await feedOver(
    [
      { ...day, t: 'AAA', n: 'Dir One', r: 'director', s: 6000, v: 60_000, a: 'X1', li: 0 }, // medium
      { ...day, t: 'BBB', n: 'Ceo Two', r: 'ceo', ti: 'CEO', s: 20000, v: 200_000, a: 'X2', li: 0 }, // strong
      { ...day, t: 'CCC', n: 'Dir Three', r: 'director', s: 2000, v: 20_000, a: 'X3', li: 0 }, // weak
    ],
    { tab: 'latest' }
  );
  assert.deepEqual(feed.stats.signals.map((s) => [s.ticker, s.level]), [['BBB', 'strong'], ['AAA', 'medium'], ['CCC', 'weak']]);
});

test('5) a fund or 10%-only holder gets the holder badge and the amount, never a size label', async () => {
  // Berkshire buying LEN: $43.5M in one line — a "small buy" label would be absurd
  const len = { n: 'BERKSHIRE HATHAWAY INC', r: 'owner10', t: 'LEN', k: 'P', a: 'LEN-1', li: 0, s: 532993, p: 81.65, v: 43_518_878, o: 5_000_000, d: '2026-09-17', f: '2026-09-18' };
  const feed = await feedOver([len], { tab: 'latest' });
  assert.equal(feed.rows[0].holder, 'fund');
  const page = fs.readFileSync(path.join(root, 'client', 'src', 'pages', 'Insiders.jsx'), 'utf8');
  assert.match(page, /\{!r\.holder && level !== 'none' && \(/, 'no size label when there is a holder badge');
  assert.match(page, /t\(`ins\.holder\.\$\{r\.holder\}`\)/);
});

// ---- price checks at read time: CX, DFDV, NCT (real rows and raw Form 4 fields) ----

import { priceCheck } from '../api/_lib/insiderPriceCheck.js';

async function feedWithRaw(entries, query) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ins-'));
  const rows = entries.map((e) => ({ ...e.row, d: '2026-09-17', f: '2026-09-18' }));
  const raw = Object.fromEntries(entries.map((e) => [`${e.row.a}:${e.row.li}`, e.raw]));
  fs.writeFileSync(path.join(dir, 'insiders.json'), JSON.stringify({ updatedAt: '2026-09-19T04:00:00Z', rows, companies: {} }));
  fs.writeFileSync(path.join(dir, 'insiders-raw.json'), JSON.stringify({ rows: raw }));
  process.env.INSIDER_DATA_DIR = dir;
  resetServedCache();
  try {
    const { answer } = await import('../api/_handlers/insider-feed.js');
    return await answer(query, { free: false });
  } finally {
    delete process.env.INSIDER_DATA_DIR;
    resetServedCache();
  }
}

test('CX: a price in Mexican pesos with no exchange rate to convert it — no dollar amount, no return, said why', async () => {
  // with api/_data/fpi.json (rates, ADR ratio) the line is converted: see
  // fpi-cases.test.mjs. Here the fixture directory has no rates.
  const { row, raw } = cases.CX_pesos;
  assert.match(raw.fn.F2, /Mexican Pesos/);
  assert.deepEqual(priceCheck(row, { raw, current: 9.71 }), { ok: false, reason: 'currency' });
  const feed = await feedWithRaw([cases.CX_pesos], { tab: 'latest' });
  const r = feed.rows[0];
  assert.deepEqual([r.ret, r.priceUnverified, r.priceNote, r.hitRate], [null, true, 'currency', { unverified: true }]);
  assert.deepEqual([r.value, r.valueUnverified, r.currency, r.localValue], [null, true, 'MXN', Math.round(row.s * row.p)]);
  assert.equal(r.signal.level, 'none', 'no verified amount, no size label');
});

test('DFDV: a preferred-stock purchase is not compared with the common price', async () => {
  const { row, raw } = cases.DFDV_preferred;
  assert.match(raw.st, /Preferred/);
  assert.deepEqual(priceCheck(row, { raw, current: 6.04 }), { ok: false, reason: 'security' });
  // its own category ("İmtiyazlı hisse alımı"): not in the default
  // open-market feed, shown with the other transaction types
  assert.equal((await feedWithRaw([cases.DFDV_preferred], { tab: 'latest' })).rows.length, 0);
  const feed = await feedWithRaw([cases.DFDV_preferred], { tab: 'latest', types: 'all' });
  assert.deepEqual([feed.rows[0].category, feed.rows[0].side, feed.rows[0].ret, feed.rows[0].holder], ['preferred', 'buy', null, 'owner10']);
  // the common stock of the same company is still compared
  assert.equal(priceCheck(row, { raw: { ...raw, st: 'Common Stock' }, current: 8.5 }).ok, true);
});

test('NCT: no price history and 11× away from today (unrecorded reverse split) — "fiyat doğrulanamadı"', async () => {
  const { row, raw } = cases.NCT_reverse_split;
  assert.equal(row.p, 0.4);
  assert.equal(raw.st, 'Class B Ordinary Shares', 'ordinary shares: the security itself is fine');
  assert.deepEqual(priceCheck(row, { raw, series: null, current: 4.43 }), { ok: false, reason: 'unverifiable' });
  assert.deepEqual(priceCheck(row, { raw, series: null, current: 0.55 }), { ok: true, reason: null }, 'within 2×: shown');
  // the teaser (home and penny widgets) applies the same check
  const t = buildTeaser([{ ...row, d: '2026-09-17', f: '2026-09-18' }], {}, { NCT: { px: 4.43 } }, Date.parse('2026-09-19'), { raw: { [`${row.a}:${row.li}`]: raw } });
  assert.equal(t.rows[0].ret, undefined, 'no "+1,007.5%" on the home page');
  assert.equal(t.penny.rows[0]?.ret, undefined);
});
