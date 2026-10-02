// client/public/universe-summary.json is the definition's output and nothing
// else: on 2026-10-02 a data run on older code wrote $79.6T and 8,909 funds
// by the old definition, and the server HTML said "9.000+" besides.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { universeSummaryFile } from '../api/_lib/universeSummary.js';
import { changedCode, CODE_PATHS } from '../scripts/stale-code-guard.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

test('the committed universe-summary.json is universeSummaryFile(universe.json), field for field', () => {
  const file = read('client/public/universe-summary.json');
  const def = universeSummaryFile(read('client/public/universe.json'), root);
  assert.deepEqual(file, def);
  for (const k of ['quarter', 'inTotal', 'stale', 'duplicates', 'optionsExcluded']) assert.ok(k in file, `missing ${k}`);
});

test('every writer of the file goes through writeUniverseSummaryFile', () => {
  const writers = [];
  for (const dir of ['scripts', 'api']) {
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(m?js)$/.test(e.name)) {
          const src = fs.readFileSync(path.join(root, p), 'utf8');
          if (/writeFileSync\([^)]*universe-summary\.json/.test(src) || /writeJson\([^)]*universe-summary\.json/.test(src)) writers.push(p);
        }
      }
    };
    walk(dir);
  }
  assert.deepEqual(writers.filter((p) => p !== path.join('api', '_lib', 'universeSummary.js')), []);
  for (const p of ['scripts/build-universe.mjs', 'scripts/repair-units.mjs', 'scripts/measure-options.mjs']) assert.match(fs.readFileSync(path.join(root, p), 'utf8'), /writeUniverseSummaryFile\(/, p);
});

test('the server HTML reads the same file the browser fetches, and no page has a fixed fund count', async () => {
  const { readStatic } = await import('../api/_lib/ssr/routes.js');
  assert.deepEqual(readStatic('universe-summary.json'), read('client/public/universe-summary.json'));
  assert.match(fs.readFileSync(path.join(root, 'api/ssr.js'), 'utf8'), /readStatic\('universe-summary\.json'\)/);
  for (const p of ['client/src/pages/Home.jsx', 'client/src/pages/Pricing.jsx', 'client/src/components/TopBar.jsx']) assert.doesNotMatch(fs.readFileSync(path.join(root, p), 'utf8'), /9[.,]000\+/, p);
});

test('stale-code guard: a code change during the run stops the push; a data-only change does not', () => {
  const fake = (out) => (args) => {
    assert.deepEqual(args.slice(0, 4), ['diff', '--name-only', 'aaa', 'HEAD']);
    assert.deepEqual(args.slice(5), CODE_PATHS);
    return out;
  };
  assert.deepEqual(changedCode('aaa', 'HEAD', fake('scripts/build-universe.mjs\napi/_lib/universeSummary.js\n')), ['scripts/build-universe.mjs', 'api/_lib/universeSummary.js']);
  assert.deepEqual(changedCode('aaa', 'HEAD', fake('')), []);
  assert.deepEqual(changedCode(null), []);
  for (const wf of ['universe', 'consensus', 'insiders', 'fpi']) assert.match(fs.readFileSync(path.join(root, `.github/workflows/${wf}.yml`), 'utf8'), /stale-code-guard\.mjs \|\| exit 1/, wf);
});

test('a fund that files Q3 while Q2 is the reference keeps its Q2 figures in the total and the count', async () => {
  const { summarizeUniverse, referenceRow } = await import('../api/_lib/universeSummary.js');
  const asOf = '2026-10-02';
  const q2 = [
    { cik: '0000000001', reportDate: '2026-06-30', acc: 'q2-1', aum: 1000, putCallValue: 100, positions: 10 },
    { cik: '0000000002', reportDate: '2026-06-30', acc: 'q2-2', aum: 500, putCallValue: 0, positions: 5 },
  ];
  const before = summarizeUniverse(q2, { asOf });
  // fund 1 files its Q3 book on 1 October: the row now shows Q3, the total stays Q2
  const q3row = { ...q2[0], reportDate: '2026-09-30', acc: 'q3-1', aum: 1400, putCallValue: 0, positions: 14, ref: referenceRow({ reportDate: '2026-06-30', acc: 'q2-1', aum: 1000, positions: [...Array(9)].map(() => ({ value: 100 })).concat([{ value: 100, putCall: 'Call' }]) }) };
  const after = summarizeUniverse([q3row, q2[1]], { asOf });
  assert.equal(after.count, before.count);
  assert.equal(after.inTotal, before.inTotal);
  assert.equal(after.totalAum, before.totalAum);
  assert.equal(after.optionsExcluded, before.optionsExcluded);
  assert.equal(after.totalPositions, before.totalPositions);
  assert.equal(after.fromReference, 1);
  // once the Q3 deadline passes (14 November), Q3 is the reference and the row counts as filed
  const nov = summarizeUniverse([q3row, q2[1]], { asOf: '2026-11-14' });
  assert.equal(nov.quarter, '2026-09-30');
  assert.equal(nov.totalAum, 1400);
  assert.equal(nov.stale, 1);
});

test('a Q3 filer whose Q2 filing was another filer\'s table stays out of the Q2 total', async () => {
  const { summarizeUniverse } = await import('../api/_lib/universeSummary.js');
  const { markMisfiled } = await import('../api/_lib/misfiledBooks.js');
  const rows = [{ cik: '0001812095', reportDate: '2026-09-30', acc: 'q3', aum: 5e8, positions: 10, ref: { reportDate: '2026-06-30', acc: '0001752724-26-000051', aum: 751e9, putCallValue: 0, positions: 3439 } }];
  markMisfiled(rows);
  assert.equal(rows[0].misfiled, undefined);
  assert.ok(rows[0].ref.misfiled);
  const s = summarizeUniverse(rows, { asOf: '2026-10-02' });
  assert.equal(s.inTotal, 0);
  assert.equal(s.duplicates, 1);
});

test('stale-code retry: one dispatch on the current code, the alarm only when the retry is stale too', async () => {
  const { dispatchRequest, RETRY_TRIGGER } = await import('../scripts/rerun-workflow.mjs');
  const { url, init } = dispatchRequest({ repo: 'o/r', workflow: 'universe.yml', ref: 'main', token: 't' });
  assert.equal(url, 'https://api.github.com/repos/o/r/actions/workflows/universe.yml/dispatches');
  assert.deepEqual(JSON.parse(init.body), { ref: 'main', inputs: { trigger: RETRY_TRIGGER } });
  for (const wf of ['universe', 'consensus', 'insiders', 'fpi']) {
    const src = fs.readFileSync(path.join(root, `.github/workflows/${wf}.yml`), 'utf8');
    assert.match(src, /id: commit/, wf);
    assert.match(src, new RegExp(`steps\\.commit\\.outputs\\.stale == 'true' && inputs\\.trigger != 'stale-retry' }}\\s*\\n\\s*run: node scripts/rerun-workflow\\.mjs ${wf}\\.yml`), wf);
    assert.match(src, /actions: write/, wf);
    if (wf !== 'fpi') assert.match(src, /failure\(\) && !\(steps\.commit\.outputs\.stale == 'true' && inputs\.trigger != 'stale-retry'\)/, wf);
  }
  assert.match(fs.readFileSync(path.join(root, 'scripts/stale-code-guard.mjs'), 'utf8'), /stale=true/);
});
