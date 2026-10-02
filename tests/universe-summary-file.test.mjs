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
