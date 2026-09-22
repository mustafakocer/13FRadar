import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from './helpers.mjs';
import { netActivity, storiesByManager, activityRow } from '../api/_lib/netActivity.js';
import { GURUS, CATEGORIES, activeGurus, consensusPanel, historyPanel, isActive, coverage, uncategorised, guruByCik } from '../api/_lib/gurus.js';
import { CONSENSUS_MANAGERS } from '../api/_lib/consensusList.js';
import { POPULAR_MANAGERS } from '../client/src/data/popular.js';

// #5 — one net-activity definition ------------------------------------------

const pos = (cusip, shares, value, issuer = cusip) => ({ cusip, issuer, shares, value, weight: 1, putCall: '' });

test('net $ = Σ(Δshares) × period-end price; a new position counts in full, an exit at the previous price', () => {
  const managers = [
    // A: opens X (100 sh @ $10), doubles Y (100 → 200 @ $5), exits Z (held 50 @ $2)
    { cik: 'A', name: 'A', reportDate: '2026-06-30', cur: { positions: [pos('X', 100, 1000), pos('Y', 200, 1000)] }, prev: { positions: [pos('Y', 100, 400), pos('Z', 50, 100)] } },
    // B: trims Y (300 → 250 @ $5), holds X unchanged
    { cik: 'B', name: 'B', reportDate: '2026-06-30', cur: { positions: [pos('Y', 250, 1250), pos('X', 10, 100)] }, prev: { positions: [pos('Y', 300, 1200), pos('X', 10, 90)] } },
    // C: no previous quarter — holdings only, no trades
    { cik: 'C', name: 'C', reportDate: '2026-06-30', cur: { positions: [pos('X', 5, 50)] }, prev: null },
  ];
  const rows = netActivity(managers);
  const X = rows.get('X');
  assert.equal(X.price, 10);
  assert.equal(X.holderCount, 3);
  assert.equal(X.buyValue, 1000, 'the opened stake at the quarter-end price');
  assert.equal(X.sellValue, 0);
  assert.equal(X.netValue, 1000);
  assert.deepEqual([X.buyers, X.newBuyers, X.adders, X.sellers], [1, 1, 0, 0], "B's unchanged 10 shares and C's first quarter are not trades");
  const Y = rows.get('Y');
  assert.equal(Y.price, 5);
  assert.equal(Y.buyShares, 100);
  assert.equal(Y.sellShares, 50);
  assert.equal(Y.netValue, 250, '(+100 − 50) × $5');
  assert.equal(Y.buyValue - Y.sellValue, Y.netValue);
  assert.deepEqual([Y.adders, Y.reducers], [1, 1]);
  const Z = rows.get('Z');
  assert.equal(Z.holderCount, 0, 'a name the set walked out of still carries its selling');
  assert.equal(Z.price, 2, 'priced at the previous quarter when nobody holds it');
  assert.equal(Z.netValue, -100);
  assert.equal(Z.exiters, 1);
  // a price move alone is not a trade: B's X went $90 → $100 on the same 10 shares
  assert.equal(X.holders.find((h) => h.cik === 'B').activity, 'hold');
});

test('PUT/CALL rows are not trades in the underlying; a CUSIP change is not a sale when the id is the ticker', () => {
  const managers = [
    { cik: 'A', name: 'A', reportDate: 'q', cur: { positions: [{ ...pos('X', 100, 1000), putCall: 'Put' }, pos('NEW1', 100, 1000, 'ACME')] }, prev: { positions: [pos('OLD1', 100, 900, 'ACME')] } },
  ];
  const byCusip = netActivity(managers);
  assert.equal(byCusip.has('X'), false, 'the put line is skipped');
  assert.equal(byCusip.get('NEW1').newBuyers, 1, 'by CUSIP the reorganised line looks like a new buy…');
  assert.equal(byCusip.get('OLD1').exiters, 1, '…and an exit');
  const tickerOf = { NEW1: 'ACME', OLD1: 'ACME' };
  const byTicker = netActivity(managers, { idOf: (p) => tickerOf[p.cusip] || p.cusip });
  assert.equal(byTicker.get('ACME').netValue, 0, 'by ticker it is the same 100 shares held');
  assert.equal(byTicker.get('ACME').buyers + byTicker.get('ACME').sellers, 0);
});

test('stories and report rows are read off the same rows', () => {
  const managers = [
    { cik: 'A', name: 'A', reportDate: 'q', cur: { positions: [pos('X', 100, 1000), pos('Y', 200, 1000)] }, prev: { positions: [pos('Y', 100, 400), pos('Z', 50, 100)] } },
  ];
  const rows = netActivity(managers);
  const s = storiesByManager(rows).get('A');
  assert.deepEqual(s.newBuys.map((r) => [r.cusip, r.value]), [['X', 1000]]);
  assert.deepEqual(s.adds.map((r) => [r.cusip, r.value, r.change]), [['Y', 500, 100]]);
  assert.deepEqual(s.exits.map((r) => [r.cusip, r.value]), [['Z', 100]]);
  const r = activityRow(rows.get('Y'), 'Y');
  assert.deepEqual(r, { t: 'Y', g: 1, ng: 0, sh: 200, bs: 100, ss: 0, nv: 500, tv: 1000, b: 1, s: 0 });
});

// #6 — one registry ----------------------------------------------------------

test('the registry is the only fund list: 100 funds, 98 filing, valid categories, no duplicate CIKs', () => {
  const ciks = GURUS.map((g) => g.cik);
  assert.equal(new Set(ciks).size, ciks.length, 'duplicate CIK');
  for (const g of GURUS) {
    assert.match(g.cik, /^\d{10}$/, `${g.name}: CIK`);
    assert.ok(CATEGORIES.includes(g.category), `${g.name}: category ${g.category}`);
    for (const d of [g.activeFrom, g.activeTo]) if (d) assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.equal(GURUS.length, 100);
  assert.equal(GURUS.filter((g) => g.activeTo).length, 2, 'Scion and Greenlight closed, kept');
  assert.equal(activeGurus().length, 98, 'tracked = still filing');
  assert.equal(consensusPanel().length, 72, 'the consensus panel');
  assert.equal(historyPanel().length, GURUS.length - GURUS.filter((g) => g.history === false).length);
  assert.deepEqual(POPULAR_MANAGERS, GURUS, 'the client list is the registry');
  assert.deepEqual(
    CONSENSUS_MANAGERS.map((m) => m.cik),
    GURUS.filter((g) => g.consensus !== false).map((g) => g.cik),
    'the consensus list is derived from it'
  );
  assert.ok(uncategorised().length <= 8, `review the "other" bucket: ${uncategorised().map((g) => g.name).join(', ')}`);
});

test('active windows: a closed fund counts in the quarters it filed for, a successor from its first period', () => {
  const greenlight = guruByCik('0001079114');
  const dme = guruByCik('0001489933');
  assert.equal(isActive(greenlight), false);
  assert.equal(isActive(greenlight, '2023-12-31'), true);
  assert.equal(isActive(greenlight, '2024-03-31'), false);
  assert.equal(isActive(dme, '2023-12-31'), false);
  assert.equal(isActive(dme, '2024-03-31'), true);
  assert.equal(activeGurus('2023-12-31').length, 99, 'Scion + Greenlight in, DME out');
});

test('coverage explains tracked → filed → counted with reasons', () => {
  const filed = new Map(activeGurus().slice(0, 82).map((g) => [g.cik, '2026-06-30']));
  const c = coverage('2026-06-30', filed);
  assert.equal(c.tracked, 98);
  assert.equal(c.filed, 82);
  const tracked = activeGurus();
  const wide = tracked.filter((g) => g.consensus === false).length;
  const wideFiled = tracked.slice(0, 82).filter((g) => g.consensus === false).length;
  assert.equal(c.included, 82 - wideFiled, 'counted = filed discretionary books');
  assert.equal(c.excluded['wide-book'], wide, 'a wide book is excluded whether or not it filed');
  assert.equal(c.excluded['not-filed'], 16 - (wide - wideFiled), 'not filed, among the discretionary books');
  assert.equal(c.included + c.excluded['not-filed'] + c.excluded['wide-book'], 98);
  assert.deepEqual(coverage('2026-06-30', new Map()).excluded, { 'not-filed': 72, 'wide-book': 26 });
});

// The integration check: build the three datasets the pages read over the
// offline fixtures and compare a ticker's net dollars across them.
test('home, rankings and report quote the same net activity per ticker', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fundocap-activity-'));
  process.env.SEC_FIXTURE_DIR = path.join(root, 'tests', 'fixtures', 'sec');
  process.env.CONSENSUS_CIKS = '0001067983,0001336528,0001649339';
  const { build } = await import('../api/_lib/consensusBuild.js');
  const c = await build();
  const { stocks, exited, options, ...core } = c;
  const stocksFile = path.join(tmp, 'guru-stocks.json');
  fs.writeFileSync(stocksFile, JSON.stringify({ updatedAt: c.updatedAt, quarter: c.quarter, coverage: c.coverage, managers: c.managers, stocks, exited, options }));
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-guru-activity.mjs')], {
    env: { ...process.env, GURU_STOCKS_FILE: stocksFile, GURU_HISTORY_FILE: path.join(root, 'tests', 'fixtures', 'guru-history.fixture.json'), SECTOR_MAP_FILE: path.join(tmp, 'none.json'), ACTIVITY_OUT_DIR: tmp },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const activity = JSON.parse(fs.readFileSync(path.join(tmp, 'guru-activity.json'), 'utf8'));
  const report = new Map(activity.rows[activity.quarters[0]].map((x) => [x.t, x]));
  // the landing page teaser and the rankings table are the same rows
  for (const side of ['buys', 'sells']) {
    for (const row of core.activity[side]) {
      const ranked = [...stocks, ...exited].find((s) => s.cusip === row.cusip);
      assert.equal(ranked.netValue, row.netValue, `${row.ticker}: home vs rankings`);
      assert.equal(report.get(row.ticker)?.nv, row.netValue, `${row.ticker}: home vs report`);
      assert.equal(report.get(row.ticker)?.b, row.buyers, `${row.ticker}: buyers`);
    }
  }
  // every ranked ticker the report carries agrees, both directions
  let compared = 0;
  for (const s of [...stocks, ...exited]) {
    if (!s.ticker || !report.has(s.ticker)) continue;
    assert.equal(report.get(s.ticker).nv, s.netValue, `${s.ticker}: rankings vs report`);
    compared++;
  }
  assert.ok(compared >= 8, `compared ${compared} tickers`);
  // the fixture panel never walks out of a name entirely (CMG/KO keep a holder); the exited path is covered above
  assert.deepEqual(exited, []);
  assert.equal(activity.coverage.included, 3);
  assert.equal(core.topBought[0].netValue, core.activity.buys[0].netValue);
  fs.rmSync(tmp, { recursive: true, force: true });
});
