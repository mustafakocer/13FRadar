// A count is the filing's own, never the length of a list the free view
// trimmed: the Changes tab's columns say "1 yeni · 7 artırdı" from
// portfolioChanges' counts and "+N satır daha · Pro" for the rows the free
// answer (five largest lines per list) leaves out.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import { guruHistory } from '../api/_lib/history.js';
import { changesFromHistory } from '../api/_lib/holdingsChanges.js';

const BRK = '0001067983';

test('Changes tab: column counts come from the complete books, hidden rows are named', async () => {
  const g = guruHistory(BRK);
  const q = g.quarters[g.quarters.length - 1].reportDate;
  const c = changesFromHistory(g, q).counts;
  const { status, html } = await ssr('/tr/guru/berkshire-hathaway-warren-buffett/changes');
  assert.equal(status, 200);
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes(`${c.new} yeni · ${c.added} artırdı`), `increase counts (${c.new}/${c.added}) in the column header`);
  assert.ok(text.includes(`${c.reduced} azalttı · ${c.exited} tamamen çıktı`), `decrease counts (${c.reduced}/${c.exited})`);
  // signed out: the API trims each list to five lines; the column then owes a note
  const hiddenInc = c.new + c.added - Math.min(8, Math.min(c.new, 5) + Math.min(c.added, 5));
  if (hiddenInc > 0) assert.ok(html.includes(`data-more-rows="${hiddenInc}"`), `+${hiddenInc} rows note`);
  else assert.ok(!html.includes('data-more-rows='), 'nothing hidden, no note');
});
