// The small fixes of the November audit: the stock quote block prints no
// empty rows, the home page has a real heading outline, Organization.logo is
// a square bitmap that exists, the mail landing pages answer 200, and the
// price store's memo of unknown symbols is bounded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { root, ssr, jsonLd } from './helpers.mjs';

const { withSnapshotGaps } = await import('../api/_handlers/stock.js');
const { priceSnapshot } = await import('../api/_lib/priceSnapshot.js');

const live = (price) => ({ source: 'finnhub', price: { symbol: 'X', price: 10, volume: null, high52: null, low52: null, ...price }, trading: {} });
const snap = (price, asOf = '2026-11-19') => ({ source: 'snapshot', priceAsOf: asOf, price: { high52: null, low52: null, volume: null, ...price } });

test('a live quote without a 52-week range takes the nightly one, dated', () => {
  const out = withSnapshotGaps(live(), snap({ high52: 20, low52: 5 }));
  assert.equal(out.price.high52, 20);
  assert.equal(out.price.low52, 5);
  assert.equal(out.price.range52AsOf, '2026-11-19');
  assert.equal(out.price.volume, null, 'no stored volume: stays empty');
  assert.equal(out.price.volumeAsOf, undefined);
});

test('a live range is never overwritten, and half a stored range is not used', () => {
  const own = withSnapshotGaps(live({ high52: 30, low52: 9 }), snap({ high52: 20, low52: 5 }));
  assert.equal(own.price.high52, 30);
  assert.equal(own.price.range52AsOf, undefined);
  const half = live();
  assert.equal(withSnapshotGaps(half, snap({ high52: 20 })), half, 'untouched object when nothing is filled');
  assert.equal(withSnapshotGaps(half, null), half);
  const noPrice = { price: null };
  assert.equal(withSnapshotGaps(noPrice, snap({ high52: 20, low52: 5 })), noPrice);
});

test('a stored volume fills an empty live one, with its day', () => {
  const out = withSnapshotGaps(live(), snap({ volume: 1234 }, '2026-11-18'));
  assert.equal(out.price.volume, 1234);
  assert.equal(out.price.volumeAsOf, '2026-11-18');
  assert.equal(withSnapshotGaps(live({ volume: 99 }), snap({ volume: 1234 })).price.volume, 99);
});

// The quote block as the server renders it: each <div class="kv"> is one row.
const text = (s) => s.replace(/<[^>]+>/g, '').trim();
const quoteRows = (html) => {
  const sec = /<section id="quote"[\s\S]*?<\/section>/.exec(html)?.[0] || '';
  return [...sec.matchAll(/<div class="kv"><span class="k">([\s\S]*?)<\/span><span class="v[^"]*"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => [text(m[1]), text(m[2])]);
};
const QUOTE_LABELS = ['Prev Close', 'Open', 'Day Range', '52 Week Range', 'Volume', 'Avg Volume (3M)'];

test('stock page: the quote rows a source cannot fill are left out, not printed as "—"', async () => {
  const { status, html } = await ssr('/en/stock/AAPL');
  assert.equal(status, 200);
  const rows = quoteRows(html);
  assert.ok(rows.length > 0, 'the quote block rendered');
  for (const [k, v] of rows) {
    if (QUOTE_LABELS.includes(k)) assert.notEqual(v, '—', `${k} is printed empty`);
  }
  // the nightly file has AAPL's range, so the row is there whatever answered
  const s = priceSnapshot('AAPL');
  if (s?.price?.high52 != null && s?.price?.low52 != null) {
    const row = rows.find(([k]) => k === '52 Week Range');
    assert.ok(row, `52-week row missing; rows: ${rows.map(([k]) => k).join(', ')}`);
    assert.match(row[1], /\d/);
  }
});

test('home page: one h1, at least one h2, and no h3 before the first h2', async () => {
  for (const lang of ['tr', 'en']) {
    const { status, html } = await ssr(`/${lang}`);
    assert.equal(status, 200);
    const body = html.slice(html.indexOf('<body'));
    assert.equal((body.match(/<h1[\s>]/g) || []).length, 1);
    const h2 = body.search(/<h2[\s>]/);
    const h3 = body.search(/<h3[\s>]/);
    assert.ok(h2 > -1, 'no h2 on the home page');
    assert.ok(h3 === -1 || h2 < h3, 'an h3 comes before the first h2');
  }
});

test('fund and consensus section links are a <nav>, not a tablist without tabs', async () => {
  for (const url of ['/en/guru/berkshire-hathaway-warren-buffett', '/en/consensus', '/en']) {
    const { status, html } = await ssr(url);
    assert.equal(status, 200, url);
    for (const m of html.matchAll(/<(\w+)[^>]*role="tablist"[^>]*>([\s\S]*?)<\/\1>/g)) {
      assert.ok(/role="tab"/.test(m[2]), `${url}: a tablist without role=tab children`);
    }
  }
  const { html } = await ssr('/en/consensus');
  assert.match(html, /<nav class="home-tabs fund-tabs[^"]*" aria-label="[^"]+">/);
});

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

test('Organization.logo is the square brand bitmap, and the file is 512×512', async () => {
  const { html } = await ssr('/en');
  const org = jsonLd(html).find((n) => n['@type'] === 'Organization');
  assert.ok(org, 'Organization node on the home page');
  assert.equal(org.logo?.['@type'], 'ImageObject');
  assert.match(org.logo.url, /\/logo-512\.png$/);
  assert.equal(org.logo.width, 512);
  assert.equal(org.logo.height, 512);
  assert.match(org.image, /\/api\/og$/, 'the share card stays the image');
  assert.deepEqual(pngSize(path.join(root, 'client', 'public', 'logo-512.png')), { width: 512, height: 512 });
  assert.ok(fs.existsSync(path.join(root, 'client', 'public', 'logo.svg')));
  assert.ok(fs.existsSync(path.join(root, 'client', 'dist', 'logo-512.png')), 'the build publishes it at the site root');
  // a publisher logo (articles, guides) is the same file
  const guide = await ssr('/en/rankings/most-bought');
  for (const n of jsonLd(guide.html)) {
    if (n.publisher?.logo) assert.match(n.publisher.logo.url, /\/logo-512\.png$/);
  }
});

test('/thanks and /unsubscribe answer 200, uncached and noindex', async () => {
  for (const p of ['/en/thanks', '/tr/thanks?m=newsletter', '/en/unsubscribe', '/tr/unsubscribe?t=abc']) {
    const { status, html, headers } = await ssr(p);
    assert.equal(status, 200, p);
    assert.match(html, /<meta name="robots" content="[^"]*noindex/, `${p} must not be indexed`);
    assert.match(String(headers['cache-control'] || ''), /no-store|private/, `${p} is per-visitor`);
  }
});

test('price store: unknown symbols are memoised only up to a cap', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'px-'));
  const prev = process.env.PRICES_DIR;
  process.env.PRICES_DIR = dir;
  const store = await import('../api/_lib/priceStore.js');
  store.clearSeriesCache();
  try {
    // a real series file, to drop in under other names behind the memo's back
    store.writeSeries('SEED', [{ date: '2026-11-18', close: 10 }, { date: '2026-11-19', close: 11 }]);
    const seed = path.join(dir, 'SEED.json');
    const dropIn = (sym) => fs.copyFileSync(seed, path.join(dir, `${sym}.json`));

    assert.equal(store.readSeries('EARLY'), null);
    dropIn('EARLY');
    assert.equal(store.readSeries('EARLY'), null, 'a miss under the cap is remembered');

    for (let i = 0; i < store.MAX_MISSES + 50; i++) store.readSeries(`Q${i}`);
    assert.equal(store.readSeries('LATE'), null);
    dropIn('LATE');
    assert.equal(store.readSeries('LATE')?.prices?.length, 2, 'past the cap a miss is read again, not stored');
    assert.equal(store.readSeries('SEED')?.prices?.at(-1)?.close, 11, 'hits are served as before');
  } finally {
    store.clearSeriesCache();
    if (prev === undefined) delete process.env.PRICES_DIR;
    else process.env.PRICES_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
