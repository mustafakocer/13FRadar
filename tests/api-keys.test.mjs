import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKey, hashKey, looksLikeKey, createRateLimiter, parseV1Path } from '../api/_lib/apiKeys.js';

test('generateKey / hashKey / looksLikeKey', () => {
  const k = generateKey();
  assert.ok(k.key.startsWith('13fr_'));
  assert.equal(k.hash, hashKey(k.key));
  assert.equal(k.hash.length, 64);
  assert.equal(k.prefix, k.key.slice(0, 12));
  assert.equal(looksLikeKey(k.key), true);
  assert.equal(looksLikeKey('nope'), false);
  assert.notEqual(generateKey().key, k.key);
});

test('rate limiter: sliding window, retry-after', () => {
  let t = 0;
  const rl = createRateLimiter({ limit: 3, windowMs: 1000, now: () => t });
  assert.equal(rl.check('a').ok, true);
  assert.equal(rl.check('a').ok, true);
  assert.equal(rl.check('a').remaining, 0);
  const blocked = rl.check('a');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSec, 1);
  assert.equal(rl.check('b').ok, true, 'other keys unaffected');
  t = 1001;
  assert.equal(rl.check('a').ok, true, 'window slid');
});

test('parseV1Path', () => {
  assert.deepEqual(parseV1Path(['Holdings', '0001067983']), { resource: 'holdings', params: ['0001067983'] });
  assert.deepEqual(parseV1Path([]), { resource: '', params: [] });
});
