// The price build and the insider build share one Finnhub key and never
// call it at the same time (scripts/finnhub-peer.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { peerRunning, waitForPeer } from '../scripts/finnhub-peer.mjs';

const fake = (runs) => async (url) => ({ ok: true, json: async () => ({ workflow_runs: /in_progress/.test(url) ? runs : [] }) });

test('a peer run in progress is seen; without the repo, token or peer nothing is checked', async () => {
  const on = await peerRunning({ repo: 'o/r', token: 't', workflow: 'insiders.yml', fetchImpl: fake([{ id: 7 }]) });
  assert.deepEqual([on.running, on.checked, on.runs], [true, true, [7]]);
  const off = await peerRunning({ repo: 'o/r', token: 't', workflow: 'insiders.yml', fetchImpl: fake([]) });
  assert.equal(off.running, false);
  assert.deepEqual(await peerRunning({ repo: '', token: '', workflow: '' }), { running: false, checked: false });
});

test('the price build waits for a running insider build, and gives up on Finnhub after the limit', async () => {
  let n = 0;
  const waits = [];
  const done = await waitForPeer({ check: async () => ({ running: n++ < 3, checked: true, runs: [1] }), wait: async (ms) => waits.push(ms), everyMs: 30000, maxMs: 600000, log: () => {} });
  assert.deepEqual([done.clear, done.waitedMs, waits.length], [true, 90000, 3]);
  const stuck = await waitForPeer({ check: async () => ({ running: true, checked: true, runs: [1] }), wait: async () => {}, everyMs: 30000, maxMs: 60000, log: () => {} });
  assert.deepEqual([stuck.clear, stuck.waitedMs], [false, 60000]);
});
