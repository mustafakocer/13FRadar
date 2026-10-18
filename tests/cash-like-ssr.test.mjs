import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ssr } from './helpers.mjs';
import { snapshotEntry } from '../api/_lib/latestHoldings.js';

// its own file: the snapshot table is read once per process
const SGOV = '46436E718';
const pos = (cusip, value) => ({ cusip, putCall: '', issuer: cusip, value, shares: 1, weight: 0 });

test('SSR: the fund page shows the cash-like weight beside the previous period', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cash-ssr-'));
  const file = path.join(dir, 'latest-holdings.json');
  const acc = '0000950123-26-008001';
  const positions = [pos('037833100', 9e9), pos(SGOV, 1e9)];
  fs.writeFileSync(file, JSON.stringify({ updatedAt: 'x', byCik: { '0001067983': snapshotEntry({ acc, filed: '2026-08-14', reportDate: '2026-06-30', aum: 1e10, positions, cashLikePrev: { reportDate: '2026-03-31', w: 2.5 } }) } }));
  process.env.LATEST_HOLDINGS_FILE = file;
  const { status, html } = await ssr('/tr/guru/berkshire-hathaway-warren-buffett');
  assert.equal(status, 200);
  const plain = html.replace(/<!-- -->/g, '');
  assert.match(plain, /data-cashlike="10"/);
  assert.match(plain, /Nakit benzeri 10\.0%/);
  assert.match(plain, /2026 Q1: 2\.5%/);
});
