import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr, jsonLd } from './helpers.mjs';
import { planHead, tagSignature, scriptText } from '../client/src/lib/head.js';

// #10 — one head path. The server writes every tag it owns with data-seo
// (the JSON-LD scripts included); the client mirror keeps a head that is
// identical to what it would write and replaces it only when the spec differs.

const ldTags = (html) => [...html.matchAll(/<script type="application\/ld\+json"([^>]*)>/g)].map((m) => m[1]);

test('every server-rendered JSON-LD script carries the data-seo marker, one block per type', async () => {
  for (const url of ['/tr', '/tr/guru/berkshire-hathaway-warren-buffett', '/tr/stock/AAPL', '/tr/rankings/most-bought', '/tr/calendar', '/tr/rehber/13f-nedir']) {
    const { html } = await ssr(url);
    const attrs = ldTags(html);
    assert.ok(attrs.length >= 1, `${url} has JSON-LD`);
    for (const a of attrs) assert.match(a, /data-seo/, `${url}: script without data-seo`);
    const types = jsonLd(html).map((b) => b['@type']);
    assert.equal(new Set(types).size, types.length, `${url}: duplicate JSON-LD types ${types.join(',')}`);
    // meta/link tags the page owns are marked too, and present once
    for (const re of [/rel="canonical"/g, /property="og:title"/g, /name="description"/g, /<title>/g]) {
      assert.equal((html.match(re) || []).length, 1, `${url}: ${re} once`);
    }
  }
});

test('planHead keeps an identical head and replaces a different one', () => {
  const desired = [
    { tag: 'meta', name: 'description', content: 'A & B' },
    { tag: 'link', rel: 'canonical', href: 'https://x.test/tr' },
    { tag: 'script', type: 'application/ld+json', text: '{"@type":"Person","name":"<b>"}' },
  ];
  // what the browser reads back from the server-rendered head: attributes
  // unescaped, the script text in its escaped form, data-seo present
  const existing = [
    { tag: 'meta', 'data-seo': '', name: 'description', content: 'A & B' },
    { tag: 'link', href: 'https://x.test/tr', rel: 'canonical', 'data-seo': '' },
    { tag: 'script', type: 'application/ld+json', text: scriptText('{"@type":"Person","name":"<b>"}') },
  ];
  assert.equal(planHead(existing, desired).same, true, 'identical head is kept');
  assert.equal(planHead(existing.slice(0, 2), desired).same, false, 'a missing tag triggers a rewrite');
  const changed = [...existing];
  changed[0] = { ...changed[0], content: 'C' };
  const plan = planHead(changed, desired);
  assert.equal(plan.same, false);
  assert.deepEqual(plan.replace, desired, 'the whole desired set is written');
  assert.equal(tagSignature({ tag: 'meta', b: '2', a: '1' }), tagSignature({ tag: 'meta', a: '1', b: '2' }), 'attribute order does not matter');
});
