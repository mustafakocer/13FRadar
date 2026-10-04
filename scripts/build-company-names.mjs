// SEC's ticker → registered name list into api/_data/company-names.json,
// the first source of the company name a stock page shows beside its ticker
// (api/_lib/companyNames.js; the 13F issuer name covers what it lacks).
//
//   node scripts/build-company-names.mjs
//
// Env: SEC_USER_AGENT. One request a night. A failed fetch, or an answer far
// smaller than the file on record, keeps the file on record: a stale name
// is better than none.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { secGet } from '../api/_lib/sec.js';
import { namesFromCompanyTickers } from '../api/_lib/companyNames.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.env.COMPANY_NAMES_OUT || path.join(here, '..', 'api', '_data', 'company-names.json');

const prior = (() => {
  try {
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch {
    return null;
  }
})();
const priorCount = Object.keys(prior?.names || {}).length;

let names;
try {
  const { data } = await secGet('https://www.sec.gov/files/company_tickers.json', { timeout: 30000 });
  names = namesFromCompanyTickers(data);
} catch (e) {
  console.log(`::warning::company names: SEC company_tickers.json failed (${String(e.message || e).slice(0, 120)}) — keeping ${priorCount} names on record`);
  process.exit(0);
}
const count = Object.keys(names).length;
if (count < 1000 || (priorCount && count < priorCount * 0.8)) {
  console.log(`::warning::company names: SEC answered ${count} tickers (${priorCount} on record) — keeping the file on record`);
  process.exit(0);
}
fs.writeFileSync(out, JSON.stringify({ updatedAt: new Date().toISOString(), source: 'https://www.sec.gov/files/company_tickers.json', count, names }));
console.log(`company-names.json: ${count} tickers from SEC (was ${priorCount})`);
