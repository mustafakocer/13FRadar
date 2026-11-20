// The server HTML of a page is mostly its dehydrated query state. These pages
// used to carry whole data files in it (returns.json for 4,000 symbols on
// five pages, the 6,000-row filings feed, every fund's quarter card): the
// home page was 595 KB and the filings page 1.3 MB. A seed now carries what
// the page renders; the budgets below keep it that way, measured against the
// repository's real data files, with room for the data to grow.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// real feeds, not the small fixtures helpers.mjs would point these at
const here = path.dirname(new URL(import.meta.url).pathname);
process.env.FILINGS_FILE = path.join(here, '..', 'client', 'public', 'filings.json');
process.env.GURU_STOCKS_FILE = path.join(here, '..', 'api', '_data', 'guru-stocks.json');
const { root, ssr, count } = await import('./helpers.mjs');
const { weigh } = await import('../scripts/page-weight.mjs');
const { recordAccess, covers } = await import('../client/src/lib/accessedSeed.js');
const { filingsHead, FILINGS_HEAD_ROWS } = await import('../client/src/lib/filingsHead.js');
const { consensusLite } = await import('../client/src/lib/consensusLite.js');
const { RANKING_ROWS } = await import('../client/src/lib/rankingKinds.js');

const KB = 1024;
const stateOf = (html) => JSON.parse(/<script>window\.__STATE__=(.*?)<\/script>/s.exec(html)[1]);
const dataOf = (html, key) => stateOf(html).queries.find((q) => JSON.stringify(q.queryKey) === JSON.stringify(key))?.state?.data;
const keysOf = (html) => stateOf(html).queries.map((q) => JSON.stringify(q.queryKey));

// measured after the change: home 182, filings 44, most-bought 247, compare 39
const BUDGET = {
  '/tr': 280 * KB,
  '/tr/filings': 120 * KB,
  '/tr/rankings/most-bought': 380 * KB,
  '/tr/compare': 90 * KB,
  '/tr/stock/AAPL': 170 * KB,
};

for (const [url, max] of Object.entries(BUDGET)) {
  test(`${url} stays under ${Math.round(max / KB)} KB of HTML`, async () => {
    const r = await ssr(url);
    assert.equal(r.status, 200);
    const w = weigh(r.html);
    const top = Object.entries(w.queries).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round(v / KB)} KB`).join(', ');
    assert.ok(w.html < max, `${url} is ${Math.round(w.html / KB)} KB (largest seeds: ${top})`);
  });
}

test('no page seeds a whole data file it does not render', async () => {
  for (const url of ['/tr', '/tr/rankings/most-bought', '/tr/compare', '/tr/screen/stocks', '/tr/stock/AAPL', '/tr/report', '/tr/filings']) {
    const keys = keysOf((await ssr(url)).html);
    assert.ok(!keys.includes('["static-returns"]'), `${url} seeds the whole returns file`);
    assert.ok(!keys.includes('["filings"]'), `${url} seeds the whole filings feed`);
    assert.ok(!keys.includes('["consensus"]'), `${url} seeds consensus.json with every fund's card`);
  }
  // …and the one page that shows the fund cards still has them in the HTML
  const c = dataOf((await ssr('/tr/consensus')).html, ['consensus']);
  assert.ok(Array.isArray(c?.updates) && c.updates.length > 0, 'the consensus page keeps `updates`');
});

test('the returns seed holds the symbols the page shows, and only those', async () => {
  const all = JSON.parse(fs.readFileSync(path.join(root, 'client', 'public', 'returns.json'), 'utf8')).returns;
  const r = await ssr('/tr/rankings/most-bought');
  const seed = dataOf(r.html, ['static-returns-seed']);
  const listed = dataOf(r.html, ['guru-stocks-ranking', 'most-bought']).stocks;
  assert.ok(listed.length > 20);
  // every row's symbol has an answer (null when the file has none), so the
  // browser renders the same table without fetching the file…
  assert.ok(covers(seed, listed.map((s) => s.ticker)));
  for (const s of listed) if (s.ticker) assert.deepEqual(seed[s.ticker], all[s.ticker] ?? null, s.ticker);
  // …and nothing the page does not list rides along
  const wanted = new Set(listed.map((s) => s.ticker));
  for (const k of Object.keys(seed)) assert.ok(wanted.has(k), `${k} is seeded but not listed`);
  assert.ok(Object.keys(seed).length < Object.keys(all).length / 4);

  // the home page: the picks tab's symbols, whichever tab is open
  const home = await ssr('/tr');
  const picks = dataOf(home.html, ['consensus-lite']).mostHeld.filter((x) => x.ticker).slice(0, 11).map((x) => x.ticker);
  assert.ok(covers(dataOf(home.html, ['static-returns-seed']), picks));
});

test('recordAccess: what was read is kept, a miss is a null, library probes are not symbols', () => {
  const table = { AAPL: { retYtd: 1 }, MSFT: { retYtd: 2 }, 'BRK.B': { retYtd: 3 } };
  const rec = recordAccess(table);
  assert.deepEqual(rec.proxy.AAPL, { retYtd: 1 });
  assert.equal(rec.proxy.ZZZZ, undefined);
  assert.equal(rec.proxy['BRK.B'].retYtd, 3);
  void rec.proxy.constructor;
  void rec.proxy.toJSON;
  void rec.proxy.then;
  void rec.proxy[Symbol.toPrimitive];
  assert.ok(covers(rec.proxy, ['ECHO 3.875 11-30-30', null, '']));
  assert.deepEqual(rec.picked(), { AAPL: { retYtd: 1 }, ZZZZ: null, 'BRK.B': { retYtd: 3 }, 'ECHO 3.875 11-30-30': null });
  // in the browser: the seed answers for what it holds, nulls included
  const seed = rec.picked();
  assert.equal(covers(seed, ['AAPL', 'ZZZZ', null]), true);
  assert.equal(covers(seed, ['AAPL', 'MSFT']), false);
  assert.equal(covers(seed, undefined), false, 'no list: the caller wants the whole file');
  assert.equal(covers(null, ['AAPL']), false);
});

test('the filings page: twenty rows in the HTML, the head and the true totals in the seed', async () => {
  const feed = JSON.parse(fs.readFileSync(process.env.FILINGS_FILE, 'utf8'));
  const r = await ssr('/tr/filings');
  const head = dataOf(r.html, ['filings-head']);
  assert.equal(head.rows.length, Math.min(FILINGS_HEAD_ROWS, feed.rows.length));
  assert.equal(head.total, feed.rows.length);
  assert.equal(head.amendments, feed.rows.filter((x) => x.amended).length);
  assert.deepEqual(head.quarters, feed.quarters);
  assert.deepEqual(head.rows[0], feed.rows[0]);
  // the page states the whole feed's figures, not the head's
  const n = (x) => x.toLocaleString('en-US');
  assert.ok(r.html.includes(`Son ${n(feed.rows.length)} adet 13F bildirimi`), 'answer names the feed size');
  assert.ok(r.html.includes(`${n(head.amendments)} tanesi düzeltme`), 'answer names the amendment count');
  assert.equal(count(r.html, /<tr><td class="l"><a href="\/tr\/(?:guru|filer|manager)\//g), 20);
  assert.ok(r.html.includes(`1<!-- --> / <!-- -->${Math.ceil(feed.rows.length / 20)}`), 'page count is the feed\'s');
});

test('filingsHead / consensusLite leave the source untouched and tolerate nothing', () => {
  const f = { updatedAt: 'x', count: 3, quarters: [{ quarter: 'Q3 2026', count: 3 }], rows: [{ acc: '1', amended: true }, { acc: '2' }, { acc: '3', amended: true }] };
  const h = filingsHead(f, 2);
  assert.deepEqual(h, { updatedAt: 'x', count: 3, quarters: f.quarters, rows: [f.rows[0], f.rows[1]], total: 3, amendments: 2 });
  assert.equal(f.rows.length, 3);
  assert.equal(filingsHead(null), null);
  const c = { quarter: 'q', mostHeld: [1], updates: [1, 2] };
  assert.deepEqual(consensusLite(c), { quarter: 'q', mostHeld: [1] });
  assert.deepEqual(c.updates, [1, 2]);
  assert.equal(consensusLite(null), null);
});

test('a ranking page lists exactly the rows its seed carries', async () => {
  const table = JSON.parse(fs.readFileSync(process.env.GURU_STOCKS_FILE, 'utf8'));
  assert.ok(table);
  for (const kind of ['most-bought', 'most-sold']) {
    const r = await ssr(`/tr/rankings/${kind}`);
    const seed = dataOf(r.html, ['guru-stocks-ranking', kind]);
    assert.ok(seed.available && seed.stocks.length > 0);
    assert.ok(seed.stocks.every(RANKING_ROWS[kind]), 'only rows this ranking lists');
    assert.ok(seed.universe > seed.stocks.length, 'the table\'s own totals are kept');
    // one table row per seeded stock: nothing was cut from what a crawler sees
    assert.equal(count(r.html, /<td class="l muted">\d+<\/td>/g), seed.stocks.length);
    assert.ok(!keysOf(r.html).includes('["guru-stocks",300,"","",0,0]'));
  }
});
