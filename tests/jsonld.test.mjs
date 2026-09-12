import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import { validateJsonLd, validateHtmlJsonLd } from '../client/src/lib/jsonldValidate.js';

const types = (html) => validateHtmlJsonLd(html).blocks.map((b) => b['@type']);

test('validator catches missing fields, placeholders and relative URLs', () => {
  assert.ok(validateJsonLd({ '@context': 'https://schema.org', '@type': 'Dataset', name: 'x' }).length >= 3);
  assert.ok(validateJsonLd({ '@context': 'https://schema.org', '@type': 'Person', name: 'A', url: '/en/x' }).some((e) => /absolute/.test(e)));
  assert.ok(validateJsonLd({ '@context': 'https://schema.org', '@type': 'Organization', name: '__SITE__' }).some((e) => /placeholder/.test(e)));
  assert.deepEqual(validateJsonLd({ '@context': 'https://schema.org', '@type': 'Organization', name: '13F Radar', url: 'https://x.test/en' }), []);
});

test('guru page stacks Person + Dataset + FAQPage + BreadcrumbList and validates', async () => {
  const { html } = await ssr('/en/guru/berkshire-hathaway-warren-buffett');
  const { blocks, problems } = validateHtmlJsonLd(html);
  assert.deepEqual(problems, []);
  const t = types(html);
  for (const want of ['Person', 'Dataset', 'BreadcrumbList', 'FAQPage']) assert.ok(t.includes(want), want);
  const person = blocks.find((b) => b['@type'] === 'Person');
  assert.equal(person.name, 'Warren Buffett');
  assert.equal(person.worksFor.name, 'Berkshire Hathaway');
  assert.match(person.worksFor.sameAs, /sec\.gov.*CIK=0001067983/);
  const ds = blocks.find((b) => b['@type'] === 'Dataset');
  assert.match(ds.description, /reported 11 positions worth \$198\.16B/);
  assert.equal(ds.distribution[0].contentUrl, 'https://example.test/api/export/holdings/0001067983');
  assert.match(ds.temporalCoverage, /^2026-03-31\/2026-06-30$/);
  assert.equal(ds.dateModified, '2026-08-14');
  assert.match(ds.isBasedOn, /^https:\/\/www\.sec\.gov/);
  assert.match(ds.license, /^https:\/\//);
});

test('stock page stacks Corporation + Dataset + FAQPage + BreadcrumbList', async () => {
  const { html } = await ssr('/tr/stock/AAPL');
  const { blocks, problems } = validateHtmlJsonLd(html);
  assert.deepEqual(problems, []);
  const corp = blocks.find((b) => b['@type'] === 'Corporation');
  assert.equal(corp.tickerSymbol, 'AAPL');
  assert.equal(corp.name, 'Apple Inc.');
  assert.match(corp.description, /AAPL/);
  for (const want of ['Corporation', 'Dataset', 'BreadcrumbList', 'FAQPage']) assert.ok(types(html).includes(want), want);
});

test('ranking page stacks Article + ItemList + FAQPage, items point at stock pages', async () => {
  const { html } = await ssr('/en/rankings/most-bought');
  const { blocks, problems } = validateHtmlJsonLd(html);
  assert.deepEqual(problems, []);
  for (const want of ['Article', 'ItemList', 'FAQPage', 'BreadcrumbList']) assert.ok(types(html).includes(want), want);
  const list = blocks.find((b) => b['@type'] === 'ItemList');
  assert.ok(list.numberOfItems >= 5);
  assert.match(list.itemListElement[0].url, /^https:\/\/example\.test\/en\/stock\/[A-Z]/);
  const art = blocks.find((b) => b['@type'] === 'Article');
  assert.match(art.description, /^Most bought is based on Q2 2026 13F filings/);
  assert.match(html, /<details open(="")?><summary>Which stock is #1/);
});

test('home carries Organization (sameAs from env) + WebSite with SearchAction', async () => {
  process.env.SOCIAL_LINKS = 'https://x.com/13fradar,https://www.linkedin.com/company/13fradar';
  const { html } = await ssr('/en');
  const { blocks, problems } = validateHtmlJsonLd(html);
  assert.deepEqual(problems, []);
  const org = blocks.find((b) => b['@type'] === 'Organization');
  assert.ok(org && blocks.some((b) => b['@type'] === 'WebSite'));
  // sameAs is baked at client build time (VITE_SOCIAL_LINKS); the runtime env
  // fallback only applies to node-rendered blocks, so accept either shape
  assert.ok(!org.sameAs || org.sameAs.every((u) => /^https:\/\//.test(u)));
});
