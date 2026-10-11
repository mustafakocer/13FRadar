import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../scripts/vercel-ignore.mjs';

const now = Date.parse('2026-10-11T12:00:00Z');
const base = { vercelEnv: 'production', previousSha: 'abc1234', changedFiles: ['api/_data/congress.json', 'client/public/logos/AAPL.png'], previousAt: now - 3 * 3600000, now };

test('a logos / domains / Congress refresh waits for the next deployment', () => {
  for (const message of ['chore: refresh stock logos', 'chore: refresh company domains', 'chore: refresh Congress trading data', 'chore: Congress data with SEC industry codes']) {
    assert.equal(decide({ ...base, message })[0], 'skip', message);
  }
});

test('everything else builds: other data, code, previews, doubt, a long wait', () => {
  assert.equal(decide({ ...base, message: 'chore: refresh insider trading data' })[0], 'build');
  assert.equal(decide({ ...base, message: 'chore: refresh consensus & returns data' })[0], 'build');
  assert.equal(decide({ ...base, message: 'Merge pull request #107' })[0], 'build');
  assert.equal(decide({ ...base, vercelEnv: 'preview', message: 'chore: refresh stock logos' })[0], 'build');
  assert.equal(decide({ ...base, message: 'chore: refresh stock logos', changedFiles: ['api/_lib/sec.js'] })[0], 'build', 'code in the push');
  assert.equal(decide({ ...base, message: 'chore: refresh stock logos', changedFiles: null })[0], 'build', 'previous deployment not in the clone');
  assert.equal(decide({ ...base, message: 'chore: refresh stock logos', previousSha: '' })[0], 'build');
  assert.equal(decide({ ...base, message: 'chore: refresh stock logos', previousAt: now - 13 * 3600000 })[0], 'build', 'over 12 h since the last deployment');
});
