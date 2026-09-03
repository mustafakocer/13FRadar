// Daily Form 4 ingest (P1-5). Reads EDGAR's daily form indexes for the last
// INSIDERS_DAYS days (default 3; use 30 for a first backfill), parses every
// Form 4 / 4/A XML, and maintains client/public/insiders.json: open-market
// purchases and sales (codes P / S, equity only) of the last 30 days, max
// 4,000 rows, deduplicated. Runs from .github/workflows/insiders.yml.
//
//   INSIDERS_DAYS=30 node scripts/build-insiders.mjs
//
// Source: https://www.sec.gov/Archives/edgar/daily-index/<year>/QTR<q>/form.<YYYYMMDD>.idx
// Rate: ~5 requests/second overall (SEC guidance is 10/s).
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { parseDailyIndex, mergeFeed } from '../api/_lib/form4.js';
import { fetchForm4 } from '../api/_handlers/insiders.js';

const UA = process.env.SEC_USER_AGENT || '13FRadar-insiders/1.0 (kocergpt@gmail.com)';
const DAYS = Number(process.env.INSIDERS_DAYS || 3);
const MIN_VALUE = Number(process.env.INSIDERS_MIN_VALUE || 10000);
const http = axios.create({ timeout: 60000, headers: { 'User-Agent': UA } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = path.join(process.cwd(), 'client', 'public', 'insiders.json');

function qtr(d) {
  return Math.floor(d.getUTCMonth() / 3) + 1;
}

async function dailyIndex(d) {
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const url = `https://www.sec.gov/Archives/edgar/daily-index/${d.getUTCFullYear()}/QTR${qtr(d)}/form.${ymd}.idx`;
  const r = await http.get(url, { responseType: 'text', transformResponse: [(x) => x], validateStatus: () => true });
  return r.status === 200 ? parseDailyIndex(r.data) : [];
}

async function main() {
  let existing = [];
  try {
    existing = JSON.parse(fs.readFileSync(out, 'utf8')).rows || [];
  } catch {}

  const entries = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.now() - i * 86400000);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const list = await dailyIndex(d);
    entries.push(...list);
    await sleep(250);
  }
  const seen = new Set(existing.map((r) => r.acc));
  const todo = entries.filter((e) => !seen.has(e.acc));
  console.log(`index entries: ${entries.length}, new filings to parse: ${todo.length}`);

  const fresh = [];
  let failed = 0;
  let i = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (i < todo.length) {
        const e = todo[i++];
        try {
          fresh.push(...(await fetchForm4(e.cik, e.acc, e.filed)));
        } catch {
          failed++;
        }
        if (i % 250 === 0) console.log(`  ${i}/${todo.length} (failed ${failed})`);
        await sleep(600); // 3 workers x 2 requests / 0.6s ≈ 10 req/s max, well below with latency
      }
    })
  );

  const rows = mergeFeed(existing, fresh, { minValue: MIN_VALUE });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ updatedAt: new Date().toISOString(), days: 30, minValue: MIN_VALUE, rows }));
  console.log(`insiders.json: ${rows.length} rows (parsed ${todo.length}, failed ${failed})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
