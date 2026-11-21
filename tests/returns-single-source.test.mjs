// Denetim A1 / A3: bir fonun "son 1 yıl" getirisi tek kaynaktan gelir
// (api/_lib/performance.js zinciri) ve pozisyon tablosundaki sütun çeyrek
// sonundan ölçülür, bildirim gününden değil.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, ssr } from './helpers.mjs';
import { invoke } from '../api/_lib/ssr/invoke.js';
import { sinceQuarterEnd } from '../api/_lib/sinceQuarterEnd.js';
import { chain } from '../api/_lib/performance.js';
import perfHandler from '../api/_handlers/guru-performance.js';
import { fmtDay, fmtDayRange } from '../client/src/lib/format.js';

const BRK = '0001067983';
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('sinceQuarterEnd: percent from the quarter-end close, one decimal', () => {
  // Berkshire 2026 Q3 (quarter end 30.09.2026), closes of 19.11.2026
  assert.equal(sinceQuarterEnd(344.08, 272.66), -20.8); // GOOGL
  assert.equal(sinceQuarterEnd(325.25, 370.11), 13.8); // CB
  // …and not from the filing day (16.11.2026), which would read −3.9 / −2.9
  assert.equal(sinceQuarterEnd(283.72, 272.66), -3.9);
  assert.equal(sinceQuarterEnd(100, 100), 0);
});

test('sinceQuarterEnd: a missing or impossible close is null, never a number', () => {
  for (const [a, b] of [
    [null, 10],
    [10, null],
    [undefined, undefined],
    [0, 10],
    [10, 0],
    [-5, 10],
    [NaN, 10],
    [Infinity, 10],
    ['abc', 10],
  ]) {
    assert.equal(sinceQuarterEnd(a, b), null, `${a} → ${b}`);
  }
});

test('the holdings handler computes the column with that helper only', () => {
  const src = read('api/_handlers/holdings.js');
  assert.match(src, /sinceReport = sinceQuarterEnd\(/);
  assert.ok(!/sinceReport = Number\(/.test(src), 'no second inline formula');
  assert.match(src, /closeOn\(ticker, meta\.reportDate\)/, 'the base is the report date (quarter end)');
});

test('column header and tooltip say quarter end, in both languages', () => {
  const i18n = read('client/src/i18n.jsx');
  assert.ok(i18n.includes("'table.sinceReport': 'Çeyrek sonundan beri'"));
  assert.ok(i18n.includes("'table.sinceReport': 'Since quarter end'"));
  for (const stale of ['Bildirimden bu yana', 'Since reported']) {
    assert.ok(!i18n.includes(stale), `"${stale}" is gone`);
  }
});

test('chain(): the window it returns is the one it measured (from → to)', () => {
  const periods = [
    { from: '2025-06-30', to: '2025-09-30', port: 1, spy: 1, coverage: 1 },
    { from: '2025-09-30', to: '2025-12-31', port: 2, spy: 1, coverage: 1 },
    { from: '2025-12-31', to: '2026-03-31', port: 2, spy: 1, coverage: 1 },
    { from: '2026-03-31', to: '2026-06-30', port: 2, spy: 1, coverage: 1 },
    { from: '2026-06-30', to: '2026-09-30', port: 2, spy: 1, coverage: 1 },
    { from: '2026-09-30', to: '2026-11-19', port: 2, spy: 1, coverage: 1, stub: true },
  ];
  const y1 = chain(periods, 1);
  // whole quarters + the stub: longer than twelve months, and it says so
  assert.equal(y1.from, '2025-09-30');
  assert.equal(y1.to, '2026-11-19');
  assert.equal(y1.port, Number(((1.02 ** 5 - 1) * 100).toFixed(1)));
});

test('fmtDay / fmtDayRange: both ends or nothing', () => {
  assert.equal(fmtDay('2025-09-30', 'tr'), '30.09.2025');
  assert.equal(fmtDay('2025-09-30', 'en'), 'Sep 30, 2025');
  assert.equal(fmtDayRange('2025-09-30', '2026-11-19', 'tr'), '30.09.2025 – 19.11.2026');
  assert.equal(fmtDayRange('2025-09-30', null, 'tr'), null);
  assert.equal(fmtDayRange(undefined, undefined, 'en'), null);
  assert.equal(fmtDay('not-a-date'), null);
  assert.equal(fmtDay('2025-13-45'), null);
});

test('Manager page has no second return calculation', () => {
  const src = read('client/src/pages/Manager.jsx');
  for (const gone of ['ret1y', 'retYtd', 'port1y', 'portYtd', 'manager.ret1y']) {
    assert.ok(!src.includes(gone), `${gone} is not in Manager.jsx`);
  }
  assert.match(src, /perf\.data\?\.horizons/, 'the figure is read from the chained horizons');
  const chart = read('client/src/components/Charts/BenchmarkBars.jsx');
  assert.ok(!/ret1y|retYtd/.test(chart), 'the chart no longer takes current-weight returns');
});

test('Berkshire: card, header strip and API carry the same 1-year figure', async () => {
  const api = await invoke(perfHandler, { cik: BRK });
  assert.equal(api.status, 200);
  const y1 = api.body.horizons.y1;
  assert.ok(Number.isFinite(y1.port), 'chained 1Y exists');
  assert.ok(y1.from && y1.to && y1.from < y1.to, 'with its window');

  // the home card file is built from the same horizons
  const cards = JSON.parse(read('client/public/guru-cards.json'));
  const card = cards.rows.find((r) => r.cik === BRK);
  assert.ok(card, 'Berkshire card');
  assert.equal(card.y1, y1.port);

  // the guru page prints it in the server HTML (no client-side stand-in)
  const { status, html } = await ssr('/tr/guru/berkshire-hathaway-warren-buffett');
  assert.equal(status, 200);
  const m = html.match(/data-y1="([^"]*)"/);
  assert.ok(m, 'the strip cell is rendered');
  assert.equal(Number(m[1]), y1.port);
  assert.ok(html.includes(fmtDayRange(y1.from, y1.to, 'tr')), 'the dates stand next to the figure');
  assert.ok(html.includes('Çeyrek sonundan beri'), 'TR column header');
});

test('guru-cards builder stores the window with the figure', () => {
  const src = read('scripts/build-guru-cards.mjs');
  assert.match(src, /y1From: y1\.from, y1To: y1\.to/);
});
