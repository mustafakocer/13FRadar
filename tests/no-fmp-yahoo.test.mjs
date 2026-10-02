import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, ssr } from './helpers.mjs';

// B — FMP and Yahoo are out of every chain, and the footer says so

const walk = (dir) =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '_data' || e.name === 'node_modules' ? [] : walk(p);
    return /\.(m?js|jsx)$/.test(e.name) ? [p] : [];
  });

test('no code asks FMP or Yahoo for anything (request time or nightly)', () => {
  const hosts = /financialmodelingprep\.com|query[12]\.finance\.yahoo\.com|finance\.yahoo\.com|fc\.yahoo\.com/;
  const hits = [...walk('api'), ...walk('scripts'), ...walk('client/src')].filter((f) => hosts.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(hits, []);
  assert.ok(!fs.existsSync(path.join(root, 'api/_lib/yahooClient.js')));
});

test('a stock page opening asks no outside provider for fundamentals or sectors', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, ...rest) => {
    calls.push(String(u));
    return realFetch(u, ...rest);
  };
  try {
    const r = await ssr('/tr/stock/AAPL');
    assert.equal(r.status, 200);
    assert.ok(!calls.some((u) => /yahoo|financialmodelingprep/.test(u)), calls.join(' '));
    // no "veri sağlayıcıdan alınamıyor" banner, no average target price
    assert.doesNotMatch(r.html, /veri sağlayıcıdan alınamıyor|Ort\. Hedef Fiyat/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the footer names the sources actually used — no FMP, no Yahoo', async () => {
  const i18n = fs.readFileSync(path.join(root, 'client/src/i18n.jsx'), 'utf8');
  const sources = [...i18n.matchAll(/'footer\.sources': '([^']*)'/g)].map((m) => m[1]);
  assert.equal(sources.length, 2);
  for (const s of sources) {
    assert.doesNotMatch(s, /Financial Modeling Prep|FMP|Yahoo/i);
    assert.match(s, /SEC EDGAR/);
  }
  const home = await ssr('/tr');
  assert.doesNotMatch(home.html, /Financial Modeling Prep|Yahoo Finance/);
  const legal = fs.readFileSync(path.join(root, 'client/src/content/legal.js'), 'utf8');
  assert.doesNotMatch(legal, /Financial Modeling Prep|Yahoo/);
});

test('a loss-making company shows "Zarar" for P/E on its page', () => {
  const page = fs.readFileSync(path.join(root, 'client/src/pages/Stock.jsx'), 'utf8');
  assert.match(page, /sec\.pe === 'loss' \? t\('stock\.loss'\)/);
  assert.match(fs.readFileSync(path.join(root, 'client/src/i18n.jsx'), 'utf8'), /'stock\.loss': 'Zarar'/);
});
