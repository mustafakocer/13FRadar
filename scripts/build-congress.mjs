// Congress (STOCK Act) trades ingest (P1-6). See api/_lib/congress.js for the
// source rationale. Produces client/public/congress.json (last 365 days,
// max 6,000 rows). Runs daily from .github/workflows/congress.yml.
//
//   node scripts/build-congress.mjs
//
// Env (override sources if the datasets move):
//   CONGRESS_HOUSE_URL   default House Stock Watcher all_transactions.json
//   CONGRESS_SENATE_URL  default Senate Stock Watcher all_transactions.json
//   CONGRESS_LEGISLATORS_URL default unitedstates/congress-legislators current
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { legislatorIndex, normalizeHouse, normalizeSenate, mergeCongress } from '../api/_lib/congress.js';

const HOUSE = process.env.CONGRESS_HOUSE_URL || 'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json';
const SENATE = process.env.CONGRESS_SENATE_URL || 'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json';
const LEGIS = process.env.CONGRESS_LEGISLATORS_URL || 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const out = path.join(process.cwd(), 'client', 'public', 'congress.json');
const http = axios.create({ timeout: 120000, headers: { 'User-Agent': '13FRadar-congress/1.0 (kocergpt@gmail.com)' } });

async function getJson(url) {
  const r = await http.get(url, { validateStatus: () => true });
  if (r.status !== 200) throw new Error(`${url} -> ${r.status}`);
  return r.data;
}

async function main() {
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(out, 'utf8')).rows || [];
  } catch {}
  const idx = legislatorIndex(await getJson(LEGIS).catch((e) => (console.warn('legislators unavailable:', e.message), [])));

  const fresh = [];
  const sources = {};
  for (const [name, url, norm] of [['house', HOUSE, normalizeHouse], ['senate', SENATE, normalizeSenate]]) {
    try {
      const rows = await getJson(url);
      const list = Array.isArray(rows) ? rows : rows?.transactions || [];
      let ok = 0;
      for (const r of list) {
        const n = norm(r, idx);
        if (n) {
          fresh.push(n);
          ok++;
        }
      }
      sources[name] = { url, rows: ok, fetchedAt: new Date().toISOString() };
      console.log(`${name}: ${ok} rows`);
    } catch (e) {
      sources[name] = { url, error: e.message };
      console.warn(`${name} failed: ${e.message} (keeping previous rows)`);
    }
  }
  if (!fresh.length && !existing.length) throw new Error('no congress data from any source');
  const rows = mergeCongress([...existing, ...fresh]);
  const matched = rows.filter((r) => r.party).length;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ updatedAt: new Date().toISOString(), days: 365, sources, rows }));
  console.log(`congress.json: ${rows.length} rows, party matched ${matched}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
