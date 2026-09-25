import test from 'node:test';
import assert from 'node:assert/strict';
import { splitLang, withLang, isLang, LANGS, DEFAULT_LANG } from '../client/src/lib/locale.js';

test('splitLang / withLang round-trip', () => {
  assert.deepEqual(splitLang('/tr/manager/1'), { lang: 'tr', path: '/manager/1' });
  assert.deepEqual(splitLang('/tr'), { lang: 'tr', path: '/' });
  assert.deepEqual(splitLang('/trending'), { lang: null, path: '/trending' });
  assert.deepEqual(splitLang('/'), { lang: null, path: '/' });
  assert.equal(withLang('tr', '/'), '/tr');
  assert.equal(withLang('tr', '/stock/AAPL'), '/tr/stock/AAPL');
});

test('the site is Turkish-only; the retired /en prefix is still recognised so it can be redirected', () => {
  assert.deepEqual(LANGS, ['tr']);
  assert.equal(DEFAULT_LANG, 'tr');
  assert.deepEqual(splitLang('/en/manager/1'), { lang: 'en', path: '/manager/1' });
  assert.equal(isLang('en'), false);
  assert.equal(isLang('tr'), true);
});
