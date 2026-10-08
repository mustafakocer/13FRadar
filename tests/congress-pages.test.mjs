import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import { validateHtmlJsonLd } from '../client/src/lib/jsonldValidate.js';
import { readServed } from '../api/_lib/congressStore.js';
import { membersList } from '../api/_lib/congressModel.js';
import { buildSitemap } from '../api/_handlers/sitemap.js';

const db = readServed();
const member = membersList(db)[0];

test('the Congress page renders its numbers and the latest trades on the server, both languages', async () => {
  for (const [url, title] of [['/en/congress', /Congress Stock Trades/], ['/tr/congress', /Kongre Hisse İşlemleri/]]) {
    const { status, html, headers } = await ssr(url);
    assert.equal(status, 200, url);
    assert.match(html, title);
    assert.match(html, /data-answer-box/);
    assert.ok((html.match(/<tr/g) || []).length > 20, `${url}: the latest trades are in the HTML`);
    assert.deepEqual(validateHtmlJsonLd(html).problems, [], url);
    assert.match(headers['cache-control'], /s-maxage=3600/);
  }
});

test("a member's page renders their trades; an unknown member is a 404", async () => {
  const { status, html } = await ssr(`/en/congress/${member.slug}`);
  assert.equal(status, 200);
  assert.ok(html.includes(member.n.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')) || html.includes(member.n), 'the name is on the page');
  assert.deepEqual(validateHtmlJsonLd(html).problems, []);
  const missing = await ssr('/en/congress/nobody-by-this-name');
  assert.equal(missing.status, 404);
});

test('the Congress sitemap lists the page and every member', () => {
  const body = buildSitemap('congress', 'https://example.test').body;
  assert.match(body, /https:\/\/example\.test\/en\/congress</);
  assert.ok(body.includes(`/en/congress/${member.slug}<`));
  assert.ok(db.counts.members > 50);
});
