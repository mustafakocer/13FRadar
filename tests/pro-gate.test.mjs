import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #11 + Ek E — the free previews: the insider feed's preview mode, the
// compare arithmetic, and the server-rendered pages a signed-out reader
// (and a crawler) gets: rows in the HTML, the lock box under them.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the compare sample is two curated funds; the real history file knows both
process.env.GURU_HISTORY_FILE = path.join(root, 'api', '_data', 'guru-history.json');
process.env.STOCK_UPSTREAM_MS = '300';
await import('./helpers.mjs');
const { ssr, jsonLd, count } = await import('./helpers.mjs');
const { invoke } = await import('../api/_lib/ssr/invoke.js');
const { default: insiderFeed } = await import('../api/_handlers/insider-feed.js');
const { compareBooks, direction, sectorPairs } = await import('../client/src/lib/compareMetrics.js');
const { validateJsonLd } = await import('../client/src/lib/jsonldValidate.js');

test('insider feed: without ?full=1 the answer is the free preview — cards, the first rows of the tab, filters ignored, CDN-cacheable', async () => {
  const latest = await invoke(insiderFeed, { tab: 'latest', q: 'ZZZZNOPE', minValue: '999999999999', period: '1d' });
  assert.equal(latest.status, 200);
  assert.equal(latest.body.preview, true);
  assert.ok(latest.body.rows.length > 0 && latest.body.rows.length <= 10, `10 rows at most (${latest.body.rows.length})`);
  assert.ok(latest.body.total > latest.body.rows.length, 'the real total is reported for the lock box');
  assert.equal(latest.body.locked, true);
  assert.ok(latest.body.stats && latest.body.stats.day, 'the market pulse card is in the preview');
  assert.ok(Array.isArray(latest.body.stats.signals), 'the signals card is in the preview');
  assert.match(latest.headers['cache-control'], /s-maxage=1800/);
  const ceo = await invoke(insiderFeed, { tab: 'ceo' });
  assert.ok(ceo.body.rows.length <= 5, `5 rows on the role tabs (${ceo.body.rows.length})`);
  assert.ok(ceo.body.rows.every((r) => r.role === 'ceo'));
  const cluster = await invoke(insiderFeed, { tab: 'cluster' });
  assert.ok(cluster.body.rows.length <= 5);
});

test('insider feed: ?full=1 is the Pro feed and answers 402 without a Pro token', async () => {
  const r = await invoke(insiderFeed, { tab: 'latest', full: '1' });
  assert.equal(r.status, 402);
  assert.equal(r.body.error, 'pro-required');
  assert.match(r.headers['cache-control'], /no-store/);
});

test('compare arithmetic: common rows with Δ and direction, only-A/B, Jaccard and weighted overlap, top-10 concentration', () => {
  const A = {
    aum: 1000,
    count: 4,
    positions: [
      { cusip: 'C1', ticker: 'AAPL', issuer: 'Apple', weight: 40, shares: 100 },
      { cusip: 'C2', ticker: 'BAC', issuer: 'Bank', weight: 30, shares: 50 },
      { cusip: 'C3', ticker: 'KO', issuer: 'Coke', weight: 20, shares: 10 },
      { cusip: 'C4', ticker: 'OXY', issuer: 'Oxy', weight: 10, shares: 5 },
    ],
  };
  const B = {
    aum: 200,
    count: 3,
    positions: [
      { cusip: 'C1', ticker: 'AAPL', issuer: 'Apple', weight: 25, shares: 20 },
      { cusip: 'C2', ticker: 'BAC', issuer: 'Bank', weight: 5, shares: 8 },
      { cusip: 'C9', ticker: 'GOOGL', issuer: 'Alphabet', weight: 70, shares: 9 },
    ],
  };
  const prevA = { positions: [{ cusip: 'C1', shares: 80 }, { cusip: 'C2', shares: 50 }] }; // C3, C4 absent → new
  const prevB = { positions: [{ cusip: 'C1', shares: 30 }] }; // filtered book: C2 unknown
  const r = compareBooks(A, B, { prevA, prevB, prevComplete: false });
  assert.deepEqual(r.common.map((c) => c.ticker), ['AAPL', 'BAC']);
  assert.equal(r.common[0].delta, 15);
  assert.equal(r.common[0].dirA, 'up');
  assert.equal(r.common[0].dirB, 'down');
  assert.equal(r.common[1].dirA, 'flat');
  assert.equal(r.common[1].dirB, null, 'unknown when the previous book was filtered and lacks the name');
  assert.deepEqual(r.onlyA.map((c) => c.ticker), ['KO', 'OXY']);
  assert.deepEqual(r.onlyB.map((c) => c.ticker), ['GOOGL']);
  assert.ok(Math.abs(r.jaccard - (2 / 5) * 100) < 1e-9, 'two common of five distinct names');
  assert.equal(r.weightedOverlap, 25 + 5);
  assert.equal(r.top10A, 100);
  assert.equal(r.top10B, 100);
  assert.equal(r.sizeA, 1000);
  assert.equal(direction(null, 5), 'new');
  assert.equal(direction(undefined, 5), null);
  const complete = compareBooks(A, B, { prevA, prevB, prevComplete: true });
  assert.equal(complete.common[1].dirB, 'new', 'a complete previous book without the name means it is new');
  const pairs = sectorPairs([{ name: 'Technology', value: 60 }, { name: '__unclassified', value: 40, unclassified: true }], [{ name: 'Energy', value: 70 }, { name: 'Technology', value: 30 }]);
  assert.deepEqual(pairs.map((p) => [p.name, p.a, p.b]), [['Energy', 0, 70], ['Technology', 60, 30], ['__unclassified', 40, 0]]);
});

test('SSR /tr/insiders: a signed-out reader gets the two cards, ten real rows and the lock box under them, with Dataset + WebPage JSON-LD', async () => {
  const { status, html, headers } = await ssr('/tr/insiders');
  assert.equal(status, 200);
  assert.match(headers['cache-control'], /s-maxage=3600/);
  assert.ok(count(html, /class="card ins-stat"/g) >= 2, 'market pulse + signals cards');
  const body = html.slice(html.indexOf('ins-table'));
  const rows = count(body.slice(0, body.indexOf('</table>')), /<tr class="ins-buy"|<tr>/g) - 1; // minus the header row
  assert.ok(rows >= 10, `at least ten trade rows in the HTML (${rows})`);
  assert.match(html, /data-pro-gate/, 'the lock box is rendered');
  assert.ok(html.indexOf('data-pro-gate') > html.indexOf('ins-table'), 'the lock box sits under the table');
  assert.match(html, /Kalan [\d.,]+ işlem Pro ile/, 'the lock box says how many trades are behind it');
  assert.match(html, /<fieldset disabled=""/, 'the filters are disabled for a free reader');
  const blocks = jsonLd(html);
  const types = blocks.map((b) => b['@type']);
  assert.ok(types.includes('Dataset') && types.includes('WebPage'), `Dataset + WebPage (${types.join(', ')})`);
  for (const b of blocks) assert.deepEqual(validateJsonLd(b), [], `${b['@type']} valid`);
  const ceo = await ssr('/tr/insiders?tab=ceo');
  assert.ok(/ins-table/.test(ceo.html), 'the role tab renders its preview too');
});

test('SSR /tr/compare: the sample comparison is in the HTML — metric strip, common table with Δ, only-A/B lists, lock box', async () => {
  const { status, html } = await ssr('/tr/compare');
  assert.equal(status, 200);
  assert.match(html, /Berkshire Hathaway/);
  assert.match(html, /Himalaya Capital/);
  assert.match(html, /data-compare="strip"/);
  assert.equal(count(html, /class="card" style="padding:12px"/g), 6, 'six metrics in the strip');
  assert.match(html, /data-compare="common"/);
  assert.match(html, /Δ \(A−B\)/);
  const table = html.slice(html.indexOf('data-compare="common"'));
  assert.ok(count(table.slice(0, table.indexOf('</table>')), /<tr>/g) >= 2, 'at least one common position row');
  assert.match(html, /Sadece A \(\d+\)/);
  assert.match(html, /Sadece B \(\d+\)/);
  assert.match(html, /data-pro-gate/);
  const types = jsonLd(html).map((b) => b['@type']);
  assert.ok(types.includes('Dataset') && types.includes('WebPage'));
});
