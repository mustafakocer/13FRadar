import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, ssr } from './helpers.mjs';
import { ownershipTrend, currentOwnership } from '../api/_lib/guruStockHistory.js';
import { sessionPlan, localOnly } from '../client/src/lib/sessionSync.js';
import { universeSummaryFile } from '../api/_lib/universeSummary.js';

const src = (...p) => fs.readFileSync(path.join(root, 'client', 'src', ...p), 'utf8');

// A2 — option lines state a notional value, not a "total value" -------------

test('option lines are labelled "Nominal değer (dayanak hisse)" with a tooltip', async () => {
  const i18n = src('i18n.jsx');
  assert.match(i18n, /'opt\.notional': 'Nominal değer \(dayanak hisse\)'/);
  assert.match(i18n, /'tips\.notional':\s*'Opsiyon satırlarında 13F/);
  // the option ownership ranking, server-rendered
  const r = await ssr('/tr/rankings/options');
  assert.equal(r.status, 200);
  assert.match(r.html, /Nominal değer \(dayanak hisse\)/);
  // the fund page's option table, its holdings rows, the stock page's option lines
  assert.match(src('pages', 'Manager.jsx'), /t\('opt\.notional'\)} <InfoTip tip="tips\.notional"/);
  assert.match(src('components', 'GuruOwnership.jsx'), /t\('opt\.notional'\)} <InfoTip tip="tips\.notional"/);
  assert.match(src('components', 'HoldingsTable.jsx'), /p\.putCall && \(\s*<span[^>]*title=\{t\('tips\.notional'\)\}> \{t\('opt\.nominalShort'\)\}/);
  assert.match(src('pages', 'Rankings.jsx'), /isOptions \? t\('opt\.notional'\)/);
});

// A3 — the stock page's guru count: one number for the header and the table --

test('the ownership table states the header\'s count for the newest quarter, panel funds only', () => {
  const gs = JSON.parse(fs.readFileSync(process.env.GURU_STOCKS_FILE, 'utf8'));
  // the handler's own reading of the table's quarter (api/_handlers/guru-stocks.js)
  const quarter = gs.quarter || (gs.managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');
  let checked = 0;
  for (const s of gs.stocks) {
    const tr = ownershipTrend({ ticker: s.ticker, cusip: s.cusip }, { current: currentOwnership(s, quarter) });
    if (!tr) continue;
    const last = tr.quarters.at(-1);
    assert.equal(last.reportDate, quarter);
    assert.equal(last.holders, s.holderCount, `${s.ticker} holders`);
    assert.equal(last.value, Math.round(s.totalValue), `${s.ticker} value`);
    checked++;
  }
  assert.ok(checked > 0);
});

test('a fund outside the consensus panel (a wide book) is not counted in any quarter of the table', () => {
  const hist = JSON.parse(fs.readFileSync(process.env.GURU_HISTORY_FILE, 'utf8'));
  // one fund's line in some security and quarter
  const [cik, g] = Object.entries(hist.gurus).find(([, x]) => Object.keys(x.positions || {}).length);
  const [cusip, pos] = Object.entries(g.positions).find(([, p]) => p.series?.length);
  const date = pos.series[0][0];
  const all = new Set(Object.keys(hist.gurus));
  const without = new Set([...all].filter((c) => c !== cik));
  const lineAt = (panel) => ownershipTrend({ cusip }, { panelOf: () => panel })?.quarters.find((q) => q.reportDate === date) || null;
  const withFund = lineAt(all);
  const withoutFund = lineAt(without);
  assert.ok(withFund, 'the fund is counted while it is in the panel');
  assert.equal((withoutFund?.holders || 0), withFund.holders - 1, 'and drops out when it is not');
  assert.match(src('components', 'GuruOwnership.jsx'), /t\('guru\.holdingDef'\)/, 'the definition is on the page');
  assert.match(src('i18n.jsx'), /'guru\.holdingDef': 'Usta sayısı: konsensüs panelindeki fonlardan/);
});

// A5 — opening a page writes nothing and loads the profile once --------------

test('auth events: one profile load per user, no watchlist write on a page open', () => {
  const u = { user: { id: 'u1' }, access_token: 'x' };
  let loaded;
  const loads = [];
  // what supabase-js reports on a page open with a stored session
  for (const ev of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'TOKEN_REFRESHED']) {
    const p = sessionPlan(ev, u, loaded);
    if (p.load) {
      loaded = p.uid;
      loads.push([ev, p.upload]);
    }
  }
  assert.deepEqual(loads, [['INITIAL_SESSION', false]], 'is_pro, profiles and watchlists read once; no upload');
  // signing in uploads only what the account lacks
  const p = sessionPlan('SIGNED_IN', u, null);
  assert.deepEqual([p.load, p.upload], [true, true]);
  assert.deepEqual(localOnly([{ cik: '1' }, { cik: '2' }], [{ cik: '1' }]), [{ cik: '2' }]);
  assert.deepEqual(localOnly([{ cik: '1' }], [{ cik: '1' }]), [], 'nothing to write when the lists agree');
  // signing out loads the signed-out state once
  assert.equal(sessionPlan('SIGNED_OUT', null, 'u1').load, true);
  const auth = src('auth.jsx');
  assert.doesNotMatch(auth, /getSession\(\)\.then/, 'no second session read beside INITIAL_SESSION');
  assert.match(auth, /if \(missing\.length\) await supabase\.from\('watchlists'\)\.upsert/, 'the only sync write is the missing rows');
});

// A6 — no "Canlı veri" / "Gerçek zamanlı"; the date the data was built ------

test('the site says "Her gün güncellenir" with the update time, never "live" or "real-time"', async () => {
  const i18n = src('i18n.jsx');
  assert.doesNotMatch(i18n, /'Canlı veri'|'Gerçek zamanlı'|'Real-time'|'Live data'/);
  assert.match(i18n, /'data\.daily': 'Her gün güncellenir'/);
  const home = await ssr('/tr');
  assert.match(home.html, /Her gün güncellenir · son güncelleme: \d{1,2} \S+ \d{4} \d{2}:\d{2} UTC/, 'home: the update time');
  assert.doesNotMatch(home.html, /Canlı veri|Gerçek zamanlı/);
  const ins = await ssr('/tr/insiders');
  assert.doesNotMatch(ins.html, /Canlı veri|Gerçek zamanlı/);
});

// A7 — universe-summary.json's updatedAt moves on every write ----------------

test('updatedAt is the write time; dataUpdatedAt the universe build it summarises', () => {
  const U = { updatedAt: '2026-10-02T07:57:54.810Z', rows: [] };
  const a = universeSummaryFile(U, root, { now: '2026-10-02T09:20:00.000Z' });
  const b = universeSummaryFile(U, root, { now: '2026-10-03T09:20:00.000Z' });
  assert.equal(a.dataUpdatedAt, U.updatedAt);
  assert.notEqual(a.updatedAt, b.updatedAt, 'a later write moves updatedAt');
  assert.equal(a.quarter, b.quarter, 'the reference quarter follows the data, not the write');
});
