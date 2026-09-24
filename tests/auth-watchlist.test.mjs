import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';

// #13 / #14 — the sign-in round trip keeps `next`, the starred fund waits
// for sign-in, and a watchlist change that fails to save is undone.
globalThis.localStorage = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
})();

const { authReturnUrl, safeNext } = await import('../client/src/lib/authRedirect.js');
const { setPendingFavorite, getPendingFavorite, consumePendingFavorite } = await import('../client/src/lib/pendingFavorite.js');
const fav = await import('../client/src/hooks/useFavorites.js');
const { ssr } = await import('./helpers.mjs');

test('the auth return URL is /account with the asking page in ?next=, and only an in-site path rides along', () => {
  assert.equal(authReturnUrl('https://www.fundocap.co', '/pricing?plan=pro_monthly'), 'https://www.fundocap.co/account?next=%2Fpricing%3Fplan%3Dpro_monthly');
  assert.equal(authReturnUrl('https://www.fundocap.co/', '/watchlist'), 'https://www.fundocap.co/account?next=%2Fwatchlist');
  assert.equal(authReturnUrl('https://www.fundocap.co', null), 'https://www.fundocap.co/account');
  assert.equal(authReturnUrl('https://www.fundocap.co', 'https://evil.example/x'), 'https://www.fundocap.co/account', 'an absolute URL is dropped');
  assert.equal(safeNext('//evil.example'), null, 'a protocol-relative URL is dropped');
  assert.equal(safeNext('/guru/berkshire-hathaway-warren-buffett'), '/guru/berkshire-hathaway-warren-buffett');
});

test('the fund starred before sign-in is kept once and handed over once', () => {
  assert.equal(getPendingFavorite(), null);
  setPendingFavorite({ cik: '0001067983', name: 'Berkshire Hathaway' });
  setPendingFavorite({ cik: '0001709323', name: 'Himalaya Capital' });
  assert.equal(getPendingFavorite().cik, '0001709323', 'the newest wins');
  const taken = consumePendingFavorite();
  assert.equal(taken.name, 'Himalaya Capital');
  assert.equal(getPendingFavorite(), null, 'taken once');
  assert.equal(consumePendingFavorite(), null);
});

test('watchlist writes are optimistic and a failed cloud write is rolled back with an error to show', async () => {
  const calls = [];
  fav._setCloud(async (mgr, adding) => {
    calls.push([mgr.cik, adding]);
    if (mgr.cik === 'BAD') throw new Error('permission denied for table watchlists');
  });
  const read = () => JSON.parse(localStorage.getItem('favorites13f') || '[]').map((f) => f.cik);
  assert.equal(await fav.setFavorite({ cik: 'A', name: 'Fund A' }, true), true);
  assert.deepEqual(read(), ['A']);
  assert.equal(await fav.setFavorite({ cik: 'BAD', name: 'Fund B' }, true), false);
  assert.deepEqual(read(), ['A'], 'the failed add was undone');
  assert.equal(await fav.setFavorite({ cik: 'A', name: 'Fund A' }, true), true, 'adding what is there is a no-op');
  assert.deepEqual(calls.map((c) => c.join(':')), ['A:true', 'BAD:true'], 'no call for a no-op');
  fav._setCloud(null);
});

test('SSR /tr/watchlist (auth not configured here): the empty list offers five gurus to add in one click', async () => {
  const { status, html } = await ssr('/tr/watchlist');
  assert.equal(status, 200);
  assert.match(html, /data-watchlist="suggested"/);
  const block = html.slice(html.indexOf('data-watchlist="suggested"'));
  assert.equal((block.slice(0, block.indexOf('</div></div>')).match(/class="chip"/g) || []).length, 5);
  assert.match(html, /Berkshire Hathaway/);
});

test('SSR /tr/account: the sign-in card is not rendered without auth configured, and the checkout link form still says so plainly', async () => {
  const { status, html } = await ssr('/tr/account');
  assert.equal(status, 200);
  assert.match(html, /Üyelik sistemi henüz aktif değil/);
});
