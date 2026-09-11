import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLang, withLang, preferredLang } from '../client/src/lib/locale.js';

test('splitLang / withLang round-trip', () => {
  assert.deepEqual(splitLang('/en/manager/1'), { lang: 'en', path: '/manager/1' });
  assert.deepEqual(splitLang('/tr'), { lang: 'tr', path: '/' });
  assert.deepEqual(splitLang('/trending'), { lang: null, path: '/trending' });
  assert.deepEqual(splitLang('/'), { lang: null, path: '/' });
  assert.equal(withLang('tr', '/'), '/tr');
  assert.equal(withLang('en', '/stock/AAPL'), '/en/stock/AAPL');
});

test('preferredLang: cookie beats country beats Accept-Language beats default', () => {
  assert.equal(preferredLang({ cookie: 'tr', country: 'US' }), 'tr');
  assert.equal(preferredLang({ cookie: 'xx', country: 'TR' }), 'tr');
  assert.equal(preferredLang({ country: 'DE', acceptLanguage: 'tr-TR,tr;q=0.9' }), 'en');
  assert.equal(preferredLang({ acceptLanguage: 'tr-TR,tr;q=0.9' }), 'tr');
  assert.equal(preferredLang({ acceptLanguage: 'en-US' }), 'en');
  assert.equal(preferredLang({}), 'en');
});
