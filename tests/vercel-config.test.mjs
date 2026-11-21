import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Vercel validates vercel.json before it builds: a deployment whose
// `includeFiles` is longer than 256 characters is refused outright, and
// nothing local notices. Two PRs each adding one file to the list did exactly
// that. The globs below also have to keep matching the files the functions
// read, and must not start matching the 22 MB insiders.json.
const cfg = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

test('vercel.json: every includeFiles fits the 256-character schema limit', () => {
  for (const [fn, f] of Object.entries(cfg.functions)) {
    assert.ok(f.includeFiles.length <= 256, `${fn}: includeFiles is ${f.includeFiles.length} characters`);
  }
});

test('vercel.json: the commands fit the same 256-character limit', () => {
  for (const k of ['buildCommand', 'installCommand', 'ignoreCommand']) {
    assert.ok((cfg[k] || '').length <= 256, `${k} is ${(cfg[k] || '').length} characters`);
  }
});

test('vercel.json: the api function still ships the split tables and the insider files it reads, and only those', () => {
  const inc = cfg.functions['api/index.js'].includeFiles;
  const globs = inc.slice(1, -1).split(',');
  const matches = (file) =>
    globs.some((g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.+').replace(/\*/g, '[^/]*') + '$').test(file));
  for (const f of [
    'api/_data/splits.json',
    'api/_data/splits-inferred.json',
    'api/_data/insiders-raw.json',
    'api/_data/insiders-raw-backfill.json',
    'api/_data/insiders-served.json',
    'api/_data/insiders-preview.json',
    'api/_data/fpi.json',
    'api/_data/prices/AAPL.json',
    'api/_data/reports/index.json',
  ]) {
    assert.ok(matches(f), `${f} is not shipped with the api function`);
  }
  assert.ok(!matches('api/_data/insiders.json'), 'the raw insiders.json must not ship with the function');
});
