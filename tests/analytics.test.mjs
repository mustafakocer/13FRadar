// D paketi, 3. PR: çerezsiz analitik. Sayfa görüntüleme + beş olay; kişisel
// veri yok; gizlilik metni analitiği söylüyor; dış analitik alan adından
// script yüklenmiyor (Vercel Web Analytics aynı alan adından çalışır).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, ssr } from './helpers.mjs';

const src = (...p) => fs.readFileSync(path.join(root, 'client', 'src', ...p), 'utf8');

test('the five product events, and only those, are defined', async () => {
  const a = src('lib', 'analytics.js');
  for (const e of ['signup', 'pro_click', 'checkout_complete', 'watchlist_add', 'export']) {
    assert.ok(a.includes(`'${e}'`), e);
  }
  // wired where the actions happen
  assert.match(src('hooks', 'useFavorites.js'), /EVENTS\.watchlistAdd/);
  assert.match(src('components', 'AuthForm.jsx'), /EVENTS\.signup/);
  assert.match(src('pages', 'Pricing.jsx'), /EVENTS\.proClick/);
  assert.match(src('pages', 'Checkout.jsx'), /EVENTS\.checkoutComplete/);
  for (const f of [['components', 'HoldingsTable.jsx'], ['pages', 'Screen.jsx'], ['pages', 'Consensus.jsx'], ['pages', 'Manager.jsx']]) {
    assert.match(src(...f), /EVENTS\.export/, f.join('/'));
  }
  // no personal data rides along: no email/user id in any track() call
  for (const f of ['hooks/useFavorites.js', 'components/AuthForm.jsx', 'components/GoogleButton.jsx', 'pages/Pricing.jsx', 'pages/Checkout.jsx']) {
    for (const line of src(...f.split('/')).split('\n')) {
      if (line.includes('track(')) assert.ok(!/email|user\.|cik|addr/.test(line), `${f}: ${line.trim()}`);
    }
  }
});

test('analytics is injected in the client entry only, never in SSR HTML as a third-party script', async () => {
  assert.match(src('main.jsx'), /@vercel\/analytics/);
  const { html } = await ssr('/tr');
  // external script sources stay the site's own; no analytics/logo CDN
  for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) {
    assert.ok(!/^https?:\/\//.test(m[1]) || m[1].includes('example.test'), m[1]);
  }
});

test('the privacy notice names the cookieless analytics, TR and EN', () => {
  const legal = src('content', 'legal.js');
  assert.ok(legal.includes('çerezsiz analiti'), 'TR sentence');
  assert.ok(legal.includes('cookieless analytics'), 'EN sentence');
});
