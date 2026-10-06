// A file that is not in the build (client/public/domains.json before the
// weekly job writes it) must not take the language redirect and come back
// as a rendered 404 page: a fetch() for JSON gets a plain 404 at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';

test('an asset-like path answers 404 text, no redirect, no render', async () => {
  for (const u of ['/domains.json', '/tr/domains.json', '/foo.png', '/en/x/y.csv']) {
    const r = await ssr(u);
    assert.equal(r.status, 404, u);
    assert.match(r.headers['content-type'] || '', /text\/plain/, u);
    assert.ok(!r.headers.location, `${u} must not redirect`);
  }
  // a page keeps the redirect and the render
  const page = await ssr('/pricing', { cookie: 'lang=tr' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.location, '/tr/pricing');
});
