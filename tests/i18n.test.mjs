// A missing translation key is invisible in review and loud on the page: t()
// falls back to the key itself, so three filter panels shipped a button
// labelled "screen.reset". These two checks catch that class of bug.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';

const SRC = path.join(root, 'client', 'src');
const i18n = fs.readFileSync(path.join(SRC, 'i18n.jsx'), 'utf8');

// the two dictionaries, in file order
const anchors = [...i18n.matchAll(/^\s*(tr|en):\s*\{/gm)];
const dicts = {};
anchors.forEach((m, i) => {
  const end = i + 1 < anchors.length ? anchors[i + 1].index : i18n.length;
  dicts[m[1]] = new Set([...i18n.slice(m.index, end).matchAll(/^\s*'([^']+)':/gm)].map((k) => k[1]));
});

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : /\.jsx?$/.test(e.name) && e.name !== 'i18n.jsx' ? [full] : [];
  });

test('every translation key exists in both locales', () => {
  assert.equal(anchors.length, 2, 'tr and en dictionaries found');
  const only = (a, b) => [...dicts[a]].filter((k) => !dicts[b].has(k));
  assert.deepEqual(only('tr', 'en'), [], 'keys missing from en');
  assert.deepEqual(only('en', 'tr'), [], 'keys missing from tr');
});

test('every t() key used in the app is defined', () => {
  const missing = [];
  for (const file of walk(SRC)) {
    const txt = fs.readFileSync(file, 'utf8');
    // direct literals only; keys built with template strings are checked by use
    for (const m of txt.matchAll(/(?<![A-Za-z0-9_.])t\('([a-z][A-Za-z0-9]*\.[A-Za-z0-9.]+)'\)/g)) {
      if (!dicts.en.has(m[1])) missing.push(`${path.basename(file)}: ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], 'undefined keys would render as raw key text');
});
