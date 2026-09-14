import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ssr, root } from './helpers.mjs';
import { buildSitemap } from '../api/_handlers/sitemap.js';

const AI_BOTS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Bingbot', 'Applebot', 'CCBot'];
// What a crawler must find on each page. A stock page is only tabular when
// the quote provider returns financial statements, so its marker is the quote
// board, which every ticker has.
const PAGES = [
  { path: '/en/guru/berkshire-hathaway-warren-buffett', marker: /<table/ },
  { path: '/en/stock/AAPL', marker: /class="kv-grid quote-grid/ },
  { path: '/tr/rankings/most-bought', marker: /<table/ },
];

test('robots.txt allows every AI crawler explicitly and blocks only private/machine paths', () => {
  const { body } = buildSitemap('robots', 'https://example.test');
  for (const ua of AI_BOTS) {
    const block = body.split('\n\n').find((b) => b.startsWith(`User-agent: ${ua}\n`));
    assert.ok(block, `${ua} block present`);
    assert.match(block, /\nAllow: \/\n/);
    assert.doesNotMatch(block, /Disallow: \/(en|tr)\/(guru|stock|rankings|insiders|filer)/);
  }
  assert.match(body, /Disallow: \/api\//);
  assert.match(body, /Disallow: \/account/);
  assert.match(body, /Disallow: \/auth\//);
  assert.doesNotMatch(body, /Disallow: \/en\/watchlist/, 'only /api, /user, /account, /auth are blocked');
  assert.match(body, /Sitemap: https:\/\/example\.test\/sitemap\.xml/);
});

test('every AI crawler UA gets full HTML with the page data — no challenge, no gating', async () => {
  for (const ua of AI_BOTS) {
    for (const { path: page, marker } of PAGES) {
      const { status, html, headers } = await ssr(page, { 'user-agent': `Mozilla/5.0 (compatible; ${ua}/1.0; +https://example.org/bot)` });
      assert.equal(status, 200, `${ua} ${page}`);
      assert.match(headers['content-type'], /text\/html/);
      assert.match(html, marker, `${ua} ${page} carries its data`);
      assert.doesNotMatch(html, /captcha|challenge-platform|cf-chl/i);
    }
  }
});

test('llms.txt follows the llmstxt.org shape and lists EN/TR URLs separately', () => {
  execFileSync('node', [path.join(root, 'scripts', 'build-llms.mjs')], { env: { ...process.env, SITE_URL: 'https://example.test' } });
  const txt = fs.readFileSync(path.join(root, 'client', 'dist', 'llms.txt'), 'utf8');
  const lines = txt.split('\n');
  assert.equal(lines[0], '# Fundocap', 'H1 title line');
  assert.ok(lines[2].startsWith('> '), 'blockquote summary');
  const h2 = lines.filter((l) => l.startsWith('## '));
  assert.ok(h2.length >= 10, `H2 sections (${h2.length})`);
  assert.ok(h2.some((h) => h === '## Gurus (EN)') && h2.some((h) => h === '## Usta Yatırımcılar (TR)'));
  assert.ok(!lines.some((l) => /^#{3,} /.test(l)), 'no H3 or deeper');
  // every section is followed by a link list
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      const next = lines.slice(i + 1).find((l) => l.trim() !== '');
      assert.match(next, /^- \[.+\]\(https:\/\/example\.test\/.*\)/, `section ${lines[i]} starts with a link`);
    }
  }
  const links = lines.filter((l) => /^- \[/.test(l));
  assert.ok(links.length >= 60, `link count ${links.length}`);
  assert.ok(links.some((l) => l.includes('https://example.test/en/guru/')) && links.some((l) => l.includes('https://example.test/tr/guru/')));
  assert.match(txt, /45 days/);
  assert.match(txt, /Time Held/);
  assert.match(txt, /Cluster buy/);
  assert.match(txt, /## Optional/);
  const full = fs.readFileSync(path.join(root, 'client', 'dist', 'llms-full.txt'), 'utf8');
  assert.ok(full.length > txt.length && full.includes('## Guru summaries (EN)'));
});

test('GPTBot and ClaudeBot get the answer box text and JSON-LD on five public pages', async () => {
  const pages = ['/en/guru/berkshire-hathaway-warren-buffett', '/tr/stock/AAPL', '/en/rankings/consensus', '/en/calendar', '/tr/reports/2026-q2'];
  for (const ua of ['GPTBot', 'ClaudeBot']) {
    for (const page of pages) {
      const { status, html } = await ssr(page, { 'user-agent': `Mozilla/5.0 (compatible; ${ua}/1.0)` });
      assert.equal(status, 200, `${ua} ${page}`);
      const box = /<p class="answer-box" data-answer-box[^>]*>([^<]{80,})<\/p>/.exec(html);
      assert.ok(box, `${ua} ${page} answer box`);
      assert.ok((html.match(/<script type="application\/ld\+json">/g) || []).length >= 1, `${ua} ${page} JSON-LD`);
    }
  }
});
