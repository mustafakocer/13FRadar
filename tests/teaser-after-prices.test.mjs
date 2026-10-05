// The home page's insider summary (insiders-teaser.json) is rebuilt by the
// consensus job on tonight's prices, so it and /insiders (computed per
// request from the closes on file) list the same clusters. pricedAt names
// the price build it was computed on; updatedAt stays the insider data's.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const prices = path.join(root, 'api', '_data', 'prices');

// a price store whose _index.json carries the given build time; the series
// files are the committed ones (linked, not copied)
function priceStore(updatedAt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teaser-prices-'));
  for (const f of fs.readdirSync(prices)) if (f !== '_index.json') fs.symlinkSync(path.join(prices, f), path.join(dir, f));
  const index = JSON.parse(fs.readFileSync(path.join(prices, '_index.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, '_index.json'), JSON.stringify({ ...index, updatedAt }));
  return dir;
}

function build(pricesDir) {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'teaser-out-')), 'insiders-teaser.json');
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-teaser.mjs')], { env: { ...process.env, PRICES_DIR: pricesDir, TEASER_OUT: out }, stdio: 'pipe' });
  return JSON.parse(fs.readFileSync(out, 'utf8'));
}

test('a new price build changes the summary file: pricedAt follows the prices, updatedAt stays the insider data', () => {
  const a = build(priceStore('2026-10-04T02:43:00.000Z'));
  const b = build(priceStore('2026-10-05T02:43:00.000Z'));
  assert.equal(a.pricedAt, '2026-10-04T02:43:00.000Z');
  assert.equal(b.pricedAt, '2026-10-05T02:43:00.000Z');
  const db = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'insiders.json'), 'utf8'));
  assert.equal(a.updatedAt, new Date(db.updatedAt).toISOString(), 'a price rebuild never makes old filings look fresh');
  assert.equal(b.updatedAt, a.updatedAt);
});

test('consensus.yml rebuilds the summary after the rebase, audits it, and commits it with the data', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'consensus.yml'), 'utf8');
  assert.match(yml, /teaser_on_tonights_prices\(\) \{[\s\S]*node scripts\/build-teaser\.mjs[\s\S]*audit-data\.mjs --only=insiders-teaser[\s\S]*git commit[^\n]*client\/public\/insiders-teaser\.json/);
  assert.match(yml, /git pull --rebase -X theirs origin "\$\{GITHUB_REF_NAME\}" && \{ node scripts\/stale-code-guard\.mjs \|\| exit 1; \} && teaser_on_tonights_prices && git push && exit 0/);
});
