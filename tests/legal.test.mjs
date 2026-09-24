import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { ssr, jsonLd } from './helpers.mjs';
import { validateJsonLd } from '../client/src/lib/jsonldValidate.js';
import { contentByPath, LEGAL } from '../client/src/content/registry.js';

// Ek F — privacy notice and terms of use, in both languages, server
// rendered, linked from the footer, with WebPage JSON-LD.
const PAGES = [
  ['/tr/gizlilik', 'Gizlilik Bildirimi', 'KOCERLER LTD'],
  ['/tr/kullanim-sartlari', 'Kullanım Şartları', 'yatırım tavsiyesi'],
  ['/en/privacy', 'Privacy Notice', 'KOCERLER LTD'],
  ['/en/terms', 'Terms of Use', 'investment advice'],
];

test('the four legal pages are 200, server-rendered, with the operator, the contact address and valid WebPage + BreadcrumbList JSON-LD', async () => {
  for (const [path, title, phrase] of PAGES) {
    const { status, html, headers } = await ssr(path);
    assert.equal(status, 200, path);
    assert.match(html, new RegExp(`<h1>${title}</h1>`), `${path} heading`);
    assert.match(html, new RegExp(phrase), `${path} mentions ${phrase}`);
    assert.match(html, /mailto:[^"]+@[^"]+/, `${path} has the contact address`);
    assert.match(html, /data-legal-contact/);
    assert.match(headers['cache-control'], /s-maxage=86400/);
    const blocks = jsonLd(html);
    const types = blocks.map((b) => b['@type']);
    assert.ok(types.includes('WebPage') && types.includes('BreadcrumbList'), `${path}: ${types.join(', ')}`);
    for (const b of blocks) assert.deepEqual(validateJsonLd(b), [], `${path} ${b['@type']}`);
  }
});

test('the footer links both pages in the page language; the other language’s slug redirects', async () => {
  const tr = await ssr('/tr');
  assert.match(tr.html, /href="\/tr\/gizlilik"/);
  assert.match(tr.html, /href="\/tr\/kullanim-sartlari"/);
  assert.match(tr.html, /href="mailto:/);
  const en = await ssr('/en');
  assert.match(en.html, /href="\/en\/privacy"/);
  assert.match(en.html, /href="\/en\/terms"/);
  const cross = await ssr('/en/gizlilik');
  assert.equal(cross.status, 301);
  assert.equal(cross.headers.location, '/en/privacy');
  assert.equal(contentByPath('/kullanim-sartlari').kind, 'legal');
  assert.equal(LEGAL.length, 2);
});

test('the contact address falls back to the placeholder when CONTACT_EMAIL is not set at build time', async () => {
  const { html } = await ssr('/en/privacy');
  assert.match(html, /hello@fundocap\.co|mailto:[^"]+@[^"]+/);
});
