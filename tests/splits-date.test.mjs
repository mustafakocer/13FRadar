// The footer states when the stock-split table last changed: the day its
// content changed (dataChangedAt), not the night the script last ran.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ssr } from './helpers.mjs';

const status = JSON.parse(fs.readFileSync(new URL('../client/public/splits-status.json', import.meta.url), 'utf8'));
const table = JSON.parse(fs.readFileSync(new URL('../api/_data/splits.json', import.meta.url), 'utf8'));

test('the footer says when the split table last changed, in both languages, from the server', async () => {
  assert.match(status.dataChangedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(status.dataChangedAt, table.dataChangedAt, 'the page and the table carry the same day');
  const [y, m, d] = status.dataChangedAt.split('-');
  const tr = (await ssr('/tr')).html.replace(/<!-- -->/g, '');
  assert.ok(tr.includes(`Hisse bölünmesi (split) tablosu son güncelleme: ${d}.${m}.${y}`), 'tr');
  const en = (await ssr('/en/insiders')).html.replace(/<!-- -->/g, '');
  assert.match(en, new RegExp(`Stock split table last updated: [A-Z][a-z]{2} ${Number(d)}, ${y}`), 'en, on any page');
});
