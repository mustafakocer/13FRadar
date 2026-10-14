// A placeholder written twice in one text must be filled with replaceAll:
// String.prototype.replace fills the first only, and the page then shows
// "{mq}" to the reader (Kingsbury's fallback note, 2026-10-14).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const src = new URL('../client/src/', import.meta.url).pathname;
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(jsx?|mjs)$/.test(d.name) ? [path.join(dir, d.name)] : []));

test('i18n: every placeholder repeated in a text is filled with replaceAll where the text is used', () => {
  const i18n = fs.readFileSync(path.join(src, 'i18n.jsx'), 'utf8');
  const repeated = new Map();
  const re = /'([a-zA-Z0-9_.]+)':\s*\n?\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(i18n))) {
    const count = {};
    for (const p of m[2].match(/\{[a-zA-Z]+\}/g) || []) count[p] = (count[p] || 0) + 1;
    for (const [p, n] of Object.entries(count)) if (n > 1) repeated.set(m[1], new Set([...(repeated.get(m[1]) || []), p]));
  }
  assert.ok(repeated.has('manager.fallback'));
  const code = files(src).filter((f) => !f.endsWith('i18n.jsx')).map((f) => [f, fs.readFileSync(f, 'utf8')]);
  for (const [key, placeholders] of repeated) {
    for (const [file, text] of code) {
      let at = text.indexOf(`t('${key}')`);
      while (at !== -1) {
        // the chain of this text only: up to the next t('…') call
        const next = text.indexOf("t('", at + 3);
        const chain = text.slice(at, Math.min(at + 600, next === -1 ? Infinity : next));
        for (const p of placeholders) {
          assert.doesNotMatch(chain, new RegExp(`\\.replace\\('${p.replace(/[{}]/g, '\\$&')}'`), `${path.basename(file)}: ${key} fills ${p} with replace, not replaceAll`);
        }
        at = text.indexOf(`t('${key}')`, at + 1);
      }
    }
  }
});
