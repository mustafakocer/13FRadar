import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The slug build never publishes a table with fewer aliases than the one it
// replaces: a redirect someone holds must keep working. Run against a
// throwaway root with a two-row universe.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repo, 'scripts', 'build-slugs.mjs');

function root({ aliases }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slugs-'));
  fs.mkdirSync(path.join(dir, 'client/public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'client/src/data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'api/_data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'client/public/universe.json'), JSON.stringify({ rows: [{ cik: '0009000001', name: 'Example Capital Management LLC', aum: 1 }, { cik: '0009000002', name: 'Other Advisors LP', aum: 2 }] }));
  const bySlug = { 'example-capital-management-llc': { cik: '0009000001', name: 'Example Capital Management LLC', kind: 'filer' } };
  const byCik = { '0009000001': { slug: 'example-capital-management-llc', name: 'Example Capital Management LLC', kind: 'filer' } };
  fs.writeFileSync(path.join(dir, 'api/_data/slugs.json'), JSON.stringify({ bySlug, byCik, aliases }));
  return dir;
}
const run = (cwd, env = {}) => spawnSync(process.execPath, [script], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
const table = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'api/_data/slugs.json'), 'utf8'));

test('a published alias is carried forward even when nothing derives it any more', () => {
  const dir = root({ aliases: { 'old-name-nobody-derives': 'example-capital-management-llc' } });
  const r = run(dir);
  assert.equal(r.status, 0, r.stderr);
  const t = table(dir);
  assert.equal(t.aliases['old-name-nobody-derives'], 'example-capital-management-llc');
  assert.ok(Object.keys(t.aliases).length >= 1 + 90, `the registry's own variants are there too (${Object.keys(t.aliases).length})`);
  assert.match(r.stdout, /aliases \(1 before, \+\d+\)/);
});

test('fewer aliases than before: nothing is written and the process fails, naming the redirects that would die', () => {
  // an alias whose target does not exist cannot be carried, so the count drops
  const dir = root({ aliases: { 'points-at-nothing': 'no-such-slug', 'also-gone': 'no-such-slug-either', 'kept': 'example-capital-management-llc' } });
  const before = fs.readFileSync(path.join(dir, 'api/_data/slugs.json'), 'utf8');
  const r = run(dir);
  assert.notEqual(r.status, 0, 'the run fails');
  assert.match(r.stderr, /::error::slugs\.json: \d+ aliases would replace 3 — 2 redirect\(s\) would die: points-at-nothing, also-gone/);
  assert.equal(fs.readFileSync(path.join(dir, 'api/_data/slugs.json'), 'utf8'), before, 'the table on disk is untouched');
  // the documented override writes, with a warning listing the drop
  const r2 = run(dir, { SLUGS_ALLOW_FEWER_ALIASES: '1' });
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stdout, /::warning::slugs\.json: 2 alias\(es\) dropped \(allowed\)/);
  assert.equal(table(dir).aliases.kept, 'example-capital-management-llc');
});
