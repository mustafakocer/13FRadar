import test from 'node:test';
import assert from 'node:assert/strict';

// EDGAR fair-access: a 429 must be retried (honouring Retry-After), a 404
// must not, and the process-wide throttle must space requests out.
process.env.SEC_RETRY_BACKOFF = '0.01,0.01';
process.env.SEC_RPS = '50';
const { secGet, secHttp } = await import('../api/_lib/sec.js');

const fail = (status, headers = {}) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, headers, data: '' } });

test('secGet retries on 429 and returns the eventual success', async () => {
  let calls = 0;
  secHttp.defaults.adapter = async (config) => {
    calls++;
    if (calls < 3) throw fail(429, { 'retry-after': '0.01' });
    return { data: { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
  };
  const { data } = await secGet('https://data.sec.gov/x');
  assert.deepEqual(data, { ok: true });
  assert.equal(calls, 3);
});

test('secGet gives up after the backoff schedule is exhausted', async () => {
  let calls = 0;
  secHttp.defaults.adapter = async () => {
    calls++;
    throw fail(429);
  };
  await assert.rejects(secGet('https://data.sec.gov/y'), /429/);
  assert.equal(calls, 3); // first try + two retries
});

test('secGet does not retry a 404', async () => {
  let calls = 0;
  secHttp.defaults.adapter = async () => {
    calls++;
    throw fail(404);
  };
  await assert.rejects(secGet('https://data.sec.gov/z'), /404/);
  assert.equal(calls, 1);
});

test('secGet spaces requests to the configured rate', async () => {
  const stamps = [];
  secHttp.defaults.adapter = async (config) => {
    stamps.push(Date.now());
    return { data: '', status: 200, statusText: 'OK', headers: {}, config };
  };
  await Promise.all(Array.from({ length: 6 }, () => secGet('https://data.sec.gov/r')));
  // 50 rps → 20 ms apart; six calls span at least ~100 ms
  assert.ok(stamps[stamps.length - 1] - stamps[0] >= 80, `spread ${stamps[stamps.length - 1] - stamps[0]}ms`);
});
