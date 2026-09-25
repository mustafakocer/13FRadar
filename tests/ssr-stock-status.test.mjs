import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';

// A stock page's HTTP status is decided by whether the symbol is ours, not by
// whether a quote provider answered. This sandbox has no route to any price
// provider, which is exactly the production day on which every /stock/* URL
// used to come back 404.
process.env.STOCK_UPSTREAM_MS = '500';
const SNAPSHOT_SYMBOL = 'TSM';

test('SSR: a stock page is 200 with its H1 when the quote is unavailable', async () => {
  const { status, html, headers } = await ssr(`/tr/stock/${SNAPSHOT_SYMBOL}`);
  assert.equal(status, 200);
  assert.ok(/<h1>/.test(html), 'content without JS');
  assert.match(html, new RegExp(`\\(${SNAPSHOT_SYMBOL}\\)`), 'the symbol is in the heading');
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/tr\/stock\/TSM"/);
  assert.match(html, /<meta property="og:locale" content="tr_TR"/);
  assert.match(html, /application\/ld\+json/, 'JSON-LD is server-rendered');
  assert.match(headers['cache-control'], /s-maxage=86400/);
  // the page says the quote is missing or dated rather than showing nothing
  assert.ok(/kapanış|geçici olarak alınamıyor|son bilinen kapanış/.test(html), 'price state is stated');
});

test('SSR: a symbol no dataset has ever seen is a real 404', async () => {
  const { status } = await ssr('/tr/stock/ZZZZNOPE');
  assert.equal(status, 404);
});

test('SSR: the fixture-served symbol still renders its full quote board', async () => {
  const { status, html } = await ssr('/tr/stock/AAPL');
  assert.equal(status, 200);
  assert.doesNotMatch(html, /geçici olarak alınamıyor/, 'a live quote shows no outage banner');
});
