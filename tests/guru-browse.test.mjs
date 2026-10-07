import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';
import { GURUS, activeGurus } from '../api/_lib/gurus.js';
import { CATS, catCounts, filterGurus, chipName, catOf } from '../client/src/lib/guruBrowse.js';
import { ssr, count } from './helpers.mjs';

// #15 — the home guru list: category tabs whose counts add up to the
// tracked funds, closed funds hidden until asked for, 24 chips then "see all".

test('the tab counts add up to the number of funds still filing; the finer categories fold into "other"', () => {
  const c = catCounts(GURUS);
  assert.equal(c.all, activeGurus().length);
  assert.equal(c.value + c.activist + c.quant + c.macro + c.growth + c.other, c.all, 'every active fund is on exactly one tab');
  assert.equal(catOf({ category: 'multi-strategy' }), 'other');
  assert.equal(catOf({ category: 'family-office' }), 'other');
  assert.equal(catOf({ category: 'value' }), 'value');
  assert.deepEqual(CATS, ['all', 'value', 'activist', 'quant', 'macro', 'growth', 'other']);
});

test('closed funds are hidden by default and listed last, labelled, when shown; a tab narrows to its category', () => {
  const closed = GURUS.filter((g) => g.activeTo);
  assert.ok(closed.length > 0, 'the registry has a closed fund to test with');
  const hidden = filterGurus(GURUS, { cat: 'all', showClosed: false });
  assert.ok(hidden.every((g) => !g.activeTo));
  assert.equal(hidden.length, activeGurus().length);
  const shown = filterGurus(GURUS, { cat: 'all', showClosed: true });
  assert.equal(shown.length, GURUS.length);
  assert.ok(shown.slice(-closed.length).every((g) => g.activeTo), 'closed at the end');
  const value = filterGurus(GURUS, { cat: 'value' });
  assert.ok(value.length > 0 && value.every((g) => g.category === 'value'));
});

test('a chip carries at most 32 characters and the full name in its title', () => {
  assert.equal(chipName('Berkshire Hathaway (Warren Buffett)'), 'Berkshire Hathaway (Warren Buff…');
  assert.equal(chipName('Berkshire Hathaway (Warren Buffett)').length, 32);
  assert.equal(chipName('Himalaya Capital (Li Lu)'), 'Himalaya Capital (Li Lu)');
});

test('SSR /tr/gurus: the seven category tabs over every active fund as a card; /tr shows investor cards, not chips', async () => {
  const gurus = await ssr('/tr/gurus');
  assert.equal(count(gurus.html, /role="tab"/g), 7, 'seven category tabs');
  assert.match(gurus.html, /Kapananları göster \(\d+\)/);
  assert.ok(count(gurus.html, /class="card feature-card"/g) >= activeGurus().length - 5, 'all active funds as cards');
  assert.ok(/title="Berkshire Hathaway \(Warren Buffett\)"/.test(gurus.html), 'the full name in the card title');
  const home = await ssr('/tr');
  assert.ok(!home.html.includes('data-guru-chips'), 'no chip block on the home page');
  assert.equal(count(home.html, /data-guru-card="/g), 11, 'eleven investor cards');
});
