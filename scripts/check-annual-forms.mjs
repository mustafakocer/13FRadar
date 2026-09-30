// The newest annual report of every issuer fpi.json treats as foreign: a
// 10-K after the last 20-F/40-F means the company files as a US company
// (api/_lib/annualForm.js). Prints ANN lines and a table; commits nothing.
//   node scripts/check-annual-forms.mjs [TICKER …]
import fs from 'node:fs';
import path from 'node:path';
import { secGet, padCik } from '../api/_lib/sec.js';
import { annualStatus } from '../api/_lib/annualForm.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const fpi = JSON.parse(fs.readFileSync(path.join(root, 'api', '_data', 'fpi.json'), 'utf8'));
const only = new Set(process.argv.slice(2).map((t) => t.toUpperCase()));
const entries = Object.entries(fpi.issuers).filter(([, v]) => v.fpi && (!only.size || only.has(v.t)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const filingsOf = (b) => (b?.form || []).map((form, i) => ({ form, date: b.filingDate[i] }));

const out = [];
for (const [cik, v] of entries) {
  try {
    const sub = (await secGet(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`)).data;
    let filings = filingsOf(sub?.filings?.recent);
    let a = annualStatus(filings);
    // an old annual report can sit beyond the 1,000 "recent" filings
    if (a.status === 'unclear') {
      for (const page of (sub?.filings?.files || []).slice(0, 3)) {
        filings = filings.concat(filingsOf((await secGet(`https://data.sec.gov/submissions/${page.name}`)).data));
        a = annualStatus(filings);
        if (a.status !== 'unclear') break;
      }
    }
    out.push({ cik, t: v.t, name: sub?.name || v.name, lf: v.lf, ...a });
    console.log(`ANN ${cik} ${v.t} ${a.status} tenK=${a.tenK || '-'} annual=${a.foreignAnnual || '-'} lf=${v.lf || '-'}`);
  } catch (e) {
    out.push({ cik, t: v.t, name: v.name, lf: v.lf, status: 'unclear', reason: `submissions: ${e.response?.status || e.message}` });
    console.log(`ANN ${cik} ${v.t} unclear error=${e.response?.status || e.message}`);
  }
  await sleep(150);
}
const count = (s) => out.filter((x) => x.status === s).length;
const lines = [
  `## Newest annual report of ${out.length} issuers treated as foreign`,
  '',
  `domestic (10-K newest): **${count('domestic')}** · foreign (20-F/40-F newest): ${count('foreign')} · unclear: ${count('unclear')}`,
  '',
  '| Ticker | Company | Status | Newest 10-K | Newest 20-F/40-F | Last foreign filing (lf) |',
  '|---|---|---|---|---|---|',
  ...out.filter((x) => x.status !== 'foreign').map((x) => `| ${x.t} | ${x.name} | ${x.status} | ${x.tenK || '—'} | ${x.foreignAnnual || '—'} | ${x.lf || '—'} |`),
];
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
