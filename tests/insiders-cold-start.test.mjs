// The insider feed's free preview is computed by the build and served from a
// small file (api/_lib/insiderPreview.js). It must be the very answer the
// dataset gives, it must not cost a cold instance the dataset, and anything
// it does not cover must still be computed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { requireBuild } from './helpers.mjs';
import {
  PREVIEW_DAYS,
  PREVIEW_TABS,
  PREVIEW_VERSION,
  acceptPreview,
  dayOf,
  packPreview,
  previewFile,
  previewFingerprint,
  previewInstants,
  readPreview,
  unpackPreview,
} from '../api/_lib/insiderPreview.js';
import { answer } from '../api/_handlers/insider-feed.js';
import { measure } from '../scripts/insiders-cold.mjs';

const DATASET = /insiders(-served|-raw|-raw-backfill)?\.json$/;
const viaJson = (x) => JSON.parse(JSON.stringify(x));

function stored() {
  requireBuild();
  assert.ok(fs.existsSync(previewFile()), 'api/_data/insiders-preview.json missing — run `npm run build` before `npm test`');
  return JSON.parse(fs.readFileSync(previewFile(), 'utf8'));
}

test('the stored form gives back every day of every tab', () => {
  const byDay = {
    '2026-11-21': { latest: { rows: [{ t: 'A' }], total: 10, locked: true, stats: { day: 'x' }, extra: 1 }, ceo: { rows: [], total: 2 } },
    '2026-11-22': { latest: { rows: [{ t: 'A' }], total: 9, locked: true, stats: { day: 'x' } }, ceo: { rows: [], total: 2 } },
    '2026-11-23': { latest: { rows: [{ t: 'B' }], total: 9, locked: false, stats: { day: 'x' }, extra: 1, more: null }, ceo: { rows: [], total: 1 } },
  };
  const tabs = viaJson(packPreview(byDay));
  for (const [day, bodies] of Object.entries(byDay)) for (const [tab, body] of Object.entries(bodies)) assert.deepEqual(unpackPreview(tabs, tab, day), body, `${tab} ${day}`);
  // a later day stores only what differs
  assert.deepEqual(tabs.latest.later['2026-11-22'], { set: { total: 9 }, drop: ['extra'] });
  assert.deepEqual(tabs.ceo.later['2026-11-22'], { set: {} });
  // a day or tab it does not hold, and names that are not its own
  assert.equal(unpackPreview(tabs, 'latest', '2026-11-24'), null);
  assert.equal(unpackPreview(tabs, 'sells', '2026-11-21'), null);
  assert.equal(unpackPreview(tabs, 'constructor', '2026-11-21'), null);
  assert.equal(unpackPreview(tabs, 'latest', 'constructor'), null);
  assert.equal(unpackPreview(null, 'latest', '2026-11-21'), null);
  // the caller gets its own object: changing it does not change the next answer
  unpackPreview(tabs, 'latest', '2026-11-21').total = 0;
  assert.equal(unpackPreview(tabs, 'latest', '2026-11-21').total, 10);
});

test('the build computes the build day and the days after it', () => {
  const at = previewInstants(Date.parse('2026-12-30T23:59:59Z'));
  assert.deepEqual(at.map(dayOf), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  assert.equal(at.length, PREVIEW_DAYS);
});

test('a preview built from other inputs, or in another format, is not used', () => {
  const tabs = { latest: { day: '2026-11-21', body: { rows: [] }, later: {} } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(acceptPreview({ version: PREVIEW_VERSION, fingerprint: 'a|1', tabs }, 'a|1'), tabs);
    assert.equal(acceptPreview({ version: PREVIEW_VERSION, fingerprint: 'a|1', tabs }, 'a|2'), null);
    assert.equal(acceptPreview({ version: PREVIEW_VERSION + 1, fingerprint: 'a|1', tabs }, 'a|1'), null);
    assert.equal(acceptPreview({ version: PREVIEW_VERSION, fingerprint: 'a|1' }, 'a|1'), null);
    assert.equal(acceptPreview(null, 'a|1'), null);
  } finally {
    console.warn = warn;
  }
});

test('the stored preview is the answer the dataset gives, for every tab and day', async () => {
  const file = stored();
  assert.equal(file.fingerprint, previewFingerprint(), 'the preview was built from other inputs — run `npm run build` again');
  assert.deepEqual(Object.keys(file.tabs), PREVIEW_TABS);
  assert.equal(file.days.length, PREVIEW_DAYS);
  for (const day of file.days) {
    const now = Date.parse(`${day}T03:21:00Z`); // any instant of the day
    for (const tab of PREVIEW_TABS) {
      const computed = viaJson(await answer({ tab }, { free: true, now, prebuilt: false }));
      assert.deepEqual(readPreview(tab, now), computed, `${tab} ${day}`);
      // and it is what the endpoint returns for that reader
      assert.deepEqual(await answer({ tab, q: 'AAPL', page: '3', perPage: '200', period: '1w' }, { free: true, now }), computed, `${tab} ${day} via answer`);
    }
  }
});

test('the preview holds nothing beyond the free preview', () => {
  const file = stored();
  for (const tab of PREVIEW_TABS) {
    const body = file.tabs[tab].body;
    assert.equal(body.preview, true, tab);
    assert.equal(body.page, 1, tab);
    assert.ok(body.rows.length <= (tab === 'latest' || tab === 'sells' ? 10 : 5), `${tab}: ${body.rows.length} rows`);
    assert.equal(body.locked, body.total > body.rows.length, tab);
    for (const p of Object.values(file.tabs[tab].later)) assert.ok(!p.set.rows || p.set.rows.length <= body.rows.length, tab);
  }
  assert.ok(fs.statSync(previewFile()).size < 300 * 1024, 'insiders-preview.json over 300 KB');
  // a build artefact for the functions, not a public file
  assert.ok(!fs.existsSync(new URL('../client/public/insiders-preview.json', import.meta.url)));
  assert.ok(!fs.existsSync(new URL('../client/dist/insiders-preview.json', import.meta.url)));
});

test('what the preview does not cover is computed from the dataset', async () => {
  const file = stored();
  const now = Date.parse(`${file.days[0]}T12:00:00Z`);
  // a day past the last one, a tab it does not know
  assert.equal(readPreview('latest', Date.parse(`${file.days.at(-1)}T12:00:00Z`) + 86400000), null);
  assert.equal(readPreview('latest', now - 86400000), null);
  assert.equal(readPreview('nope', now), null);
  // the Pro feed never comes from it
  const full = await answer({ tab: 'latest', perPage: '50' }, { free: false, now });
  assert.equal(full.preview, false);
  assert.equal(full.rows.length, 50);
  assert.equal(full.total, file.tabs.latest.body.total);
});

test('a cold instance answers the free preview without reading the dataset', () => {
  stored();
  for (const kind of ['feed', 'ssr']) {
    const r = measure(kind);
    assert.ok(r.ok, `${kind}: no answer`);
    const read = r.big.filter((b) => DATASET.test(b.file));
    assert.deepEqual(read, [], `${kind} read ${read.map((b) => b.file).join(', ')} — if the build is more than ${PREVIEW_DAYS - 1} days old, run \`npm run build\` again`);
  }
  // the same measurement with the preview switched off does read it: the
  // check above can tell
  const off = measure('feed', { INSIDER_PREVIEW_OFF: '1' });
  assert.ok(off.ok);
  assert.ok(off.big.some((b) => /insiders-served\.json$/.test(b.file)), 'the fallback did not read the dataset');
});
