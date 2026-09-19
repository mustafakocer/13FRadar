import test from 'node:test';
import assert from 'node:assert/strict';
import { ssr } from './helpers.mjs';
import { slugTable, slugify, cikForSlug, aliasForSlug, resolveSlug } from '../api/_lib/slugs.js';
import { managerPath } from '../client/src/lib/paths.js';
import { GURU_SLUGS } from '../client/src/data/guru-slugs.js';
import { POPULAR_MANAGERS } from '../client/src/data/popular.js';
import { CONSENSUS_MANAGERS } from '../api/_lib/consensusList.js';

// Every fund link the site builds has to land on a page that exists.
//
// It did not. managerPath derived a guru's slug by slugifying its curated
// name, which assumed the slug table had been built from that name. A fund
// first seen in the universe scan keeps the slug made from its EDGAR name and
// promotion to guru renames it without re-slugging, so 86 of 99 curated funds
// were linked to a URL that had never existed — the home page chips, search,
// the watchlist, the filings feed, the screener. The page itself was fine.

const curated = () => {
  const m = new Map();
  for (const x of [...POPULAR_MANAGERS, ...CONSENSUS_MANAGERS]) m.set(String(x.cik).padStart(10, '0'), x.name);
  return m;
};

test('every curated fund links to a slug that is actually in the table', () => {
  const t = slugTable();
  const dead = [];
  for (const cik of curated().keys()) {
    const path = managerPath(cik);
    const slug = path.startsWith('/guru/') ? path.slice('/guru/'.length) : null;
    if (!slug || !t.bySlug[slug]) dead.push(`${cik} → ${path}`);
  }
  assert.deepEqual(dead, [], `fund links pointing nowhere:\n  ${dead.join('\n  ')}`);
});

test('the link is the stored slug, not one derived from the name', () => {
  const t = slugTable();
  for (const [cik] of curated()) {
    assert.equal(managerPath(cik), `/guru/${t.byCik[cik].slug}`, `wrong link for ${cik}`);
  }
  // The two that made the bug visible, by name.
  assert.equal(managerPath('0001133219'), '/guru/muhlenkamp-and-co-inc');
  assert.equal(managerPath('0001569049'), '/guru/light-street-capital-management-llc');
  assert.equal(managerPath('0001067983'), '/guru/berkshire-hathaway-warren-buffett');
});

test('a hint always wins, and an unknown CIK takes the numeric route', () => {
  assert.equal(managerPath('0001067983', '/guru/whatever-the-api-said'), '/guru/whatever-the-api-said');
  assert.equal(managerPath('0009999999'), '/manager/0009999999');
  assert.equal(managerPath('9999999'), '/manager/0009999999', 'CIKs are padded');
  assert.equal(managerPath(null), '/manager/0000000000');
});

test('the shipped guru map is the slug table, filtered — nothing invented', () => {
  const t = slugTable();
  const gurus = Object.entries(t.byCik).filter(([, v]) => v.kind === 'guru');
  assert.equal(Object.keys(GURU_SLUGS).length, gurus.length, 'one entry per curated fund');
  for (const [cik, v] of gurus) {
    assert.equal(GURU_SLUGS[cik], v.slug, `${cik} disagrees with the table`);
  }
  for (const cik of Object.keys(GURU_SLUGS)) {
    assert.match(cik, /^\d{10}$/, `${cik} is not a padded CIK`);
    assert.equal(t.bySlug[GURU_SLUGS[cik]]?.cik, cik, 'the reverse lookup agrees');
  }
});

test('the URLs that were wrong for months redirect instead of dying', () => {
  // Exactly what the screenshots showed.
  assert.equal(aliasForSlug('muhlenkamp-and-co'), 'muhlenkamp-and-co-inc');
  assert.equal(aliasForSlug('light-street-capital-management'), 'light-street-capital-management-llc');
  assert.equal(aliasForSlug('berkshire-hathaway'), 'berkshire-hathaway-warren-buffett');

  const t = slugTable();
  for (const [from, to] of Object.entries(t.aliases || {})) {
    assert.ok(t.bySlug[to], `alias ${from} points at a slug that does not exist`);
    assert.ok(!t.bySlug[from], `${from} is a real slug and must not be aliased away`);
    assert.match(from, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  }
});

test('every name a fund was ever linked under resolves to it', () => {
  const t = slugTable();
  const unreachable = [];
  for (const [cik, name] of curated()) {
    const derived = slugify(name);
    const hit = resolveSlug(derived);
    // A derived slug that belongs to some other filer is that filer's page,
    // which outranks a redirect; anything else must reach the fund.
    if (!hit) unreachable.push(`${name} → /guru/${derived}`);
    else if (!t.bySlug[derived] && hit.entry.cik !== cik) unreachable.push(`${name} → ${hit.entry.name}`);
  }
  assert.deepEqual(unreachable, [], `names that reach nothing:\n  ${unreachable.join('\n  ')}`);
});

test('resolving says whether it followed a rename, and a live slug never does', () => {
  const direct = resolveSlug('berkshire-hathaway-warren-buffett');
  assert.equal(direct.alias, false);
  assert.equal(direct.canonical, 'berkshire-hathaway-warren-buffett');
  assert.equal(direct.entry.cik, '0001067983');

  const renamed = resolveSlug('berkshire-hathaway');
  assert.equal(renamed.alias, true);
  assert.equal(renamed.canonical, 'berkshire-hathaway-warren-buffett');
  assert.equal(renamed.entry.cik, '0001067983');

  assert.equal(resolveSlug('not-a-fund-at-all'), null);
  assert.equal(resolveSlug(''), null);
  assert.equal(aliasForSlug('berkshire-hathaway-warren-buffett'), null, 'a real slug is not an alias');
  assert.ok(cikForSlug('berkshire-hathaway-warren-buffett'), 'the real slug still resolves directly');
});

// The two addresses in the bug report, end to end through the server.
test('SSR: a URL the site used to build redirects to the page that exists', async () => {
  for (const [from, to] of [
    ['muhlenkamp-and-co', 'muhlenkamp-and-co-inc'],
    ['light-street-capital-management', 'light-street-capital-management-llc'],
    ['berkshire-hathaway', 'berkshire-hathaway-warren-buffett'],
  ]) {
    const r = await ssr(`/tr/guru/${from}`);
    assert.equal(r.status, 301, `/tr/guru/${from} should redirect`);
    assert.equal(r.headers.location, `/tr/guru/${to}`);
  }
});

test('SSR: the redirect keeps the sub-page and the per-stock route', async () => {
  const seg = await ssr('/tr/guru/berkshire-hathaway/changes');
  assert.equal(seg.status, 301);
  assert.equal(seg.headers.location, '/tr/guru/berkshire-hathaway-warren-buffett/changes');

  const tick = await ssr('/tr/guru/berkshire-hathaway/AAPL');
  assert.equal(tick.status, 301);
  assert.equal(tick.headers.location, '/tr/guru/berkshire-hathaway-warren-buffett/AAPL');
});

test('SSR: a real slug still serves its page, and a made-up one still 404s', async () => {
  const live = await ssr('/tr/guru/berkshire-hathaway-warren-buffett');
  assert.equal(live.status, 200, 'the canonical URL is not caught by the alias path');
  assert.ok(!/eşleşen bir fon bulunamadı/.test(live.html), 'and does not render the error box');

  const nope = await ssr('/tr/guru/bu-fon-hic-var-olmadi');
  assert.equal(nope.status, 404);
});
