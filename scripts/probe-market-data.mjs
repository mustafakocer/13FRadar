// Reachability and shape probe for every upstream the site reads, meant to
// run from a GitHub runner (the sandbox that writes the code cannot reach any
// of them). Prints, never writes. Each section is on its own: an upstream
// that hangs or answers garbage is one row in the summary, not a crash of the
// run — the last red run died on an unhandled 30s timeout from EDGAR's legacy
// company-search CGI before it reached the price providers at all.
//
//   node scripts/probe-market-data.mjs
//   PROBE_SYMBOLS=AAPL,BRK-B node scripts/probe-market-data.mjs
//
// Sections:
//   · EDGAR — submissions (SIC fields), XBRL frames (shares outstanding),
//     company_tickers, full-text search: what the nightly builds read.
//   · OpenFIGI — CINS vs CUSIP mapping, the ingest path of the security master.
//   · Price chain — FMP, TwelveData, Finnhub, each through the same function
//     the live /api/stock handler calls, then the handler's own race, then
//     the daily-close chain behind /api/chart and /api/returns.
//     Yahoo and Stooq are not probed: they are out of the live chain for good
//     (Yahoo 429s Vercel's IPs, Stooq serves a JS challenge), see
//     api/_handlers/stock.js.
//
// Exit code: 1 only when every price provider that has a key failed — the
// live quote board would be answering from the snapshot. Missing keys are
// reported and skipped, EDGAR/FIGI trouble is reported; neither turns the
// run red on its own.
import fs from 'node:fs';
import axios from 'axios';
import { hasFmp, hasTd, hasFinnhub, fmpStock, tdStock, finnhubStock, dailyCloses } from '../api/_lib/providers.js';
import { raceProviders } from '../api/_handlers/stock.js';
import { classify, snapshot } from '../api/_lib/providerHealth.js';
import { openfigiLookup } from '../api/_lib/figi.js';

const UA = process.env.SEC_USER_AGENT || 'Fundocap probe (kocergpt@gmail.com)';
const SYMBOLS = (process.env.PROBE_SYMBOLS || 'AAPL').split(',').map((s) => s.trim()).filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = axios.create({ timeout: 20000, validateStatus: () => true, headers: { 'User-Agent': UA } });
const short = (x, n = 300) => JSON.stringify(x).slice(0, n);
const section = (t) => console.log(`\n=== ${t} ===`);

// One row per upstream call: { name, ok, ms, note }. `fn` returns the note
// to print on success; anything it throws is the note of a failed row.
const rows = [];
async function probe(name, fn) {
  const t0 = Date.now();
  try {
    const note = await fn();
    rows.push({ name, ok: true, ms: Date.now() - t0, note: String(note ?? 'ok') });
    console.log(`  ok   ${name} (${Date.now() - t0}ms) ${note ?? ''}`);
  } catch (e) {
    const note = `${classify(e)}: ${String(e?.message || e).slice(0, 160)}`;
    rows.push({ name, ok: false, ms: Date.now() - t0, note });
    console.log(`  FAIL ${name} (${Date.now() - t0}ms) ${note}`);
  }
}
const expect200 = (r, what) => {
  if (r.status !== 200) throw new Error(`${what} HTTP ${r.status}`);
  return r.data;
};

// ------------------------------------------------------------------ EDGAR
section('EDGAR: submissions (SIC fields the sector map reads)');
for (const cik of ['0000320193', '0000884394', '0001067983']) {
  await probe(`edgar submissions ${cik}`, async () => {
    const d = expect200(await http.get(`https://data.sec.gov/submissions/CIK${cik}.json`), 'submissions');
    if (!d?.name) throw new Error('no name in submissions');
    const rec = d.filings?.recent || {};
    return `${d.name} sic=${d.sic} (${d.sicDescription}) tickers=${short(d.tickers, 60)} recent=${rec.form?.length ?? 0} forms`;
  });
  await sleep(250);
}

section('EDGAR: XBRL frames (shares outstanding for every filer in one call)');
const y = new Date().getUTCFullYear();
const q = Math.floor(new Date().getUTCMonth() / 3) + 1;
const prevQ = q === 1 ? `CY${y - 1}Q4I` : `CY${y}Q${q - 1}I`;
for (const f of [`dei/EntityCommonStockSharesOutstanding/shares/${prevQ}`, `dei/EntityPublicFloat/USD/CY${y - 1}Q2I`]) {
  await probe(`edgar frames ${f.split('/')[1]} ${f.split('/').pop()}`, async () => {
    const d = expect200(await http.get(`https://data.sec.gov/api/xbrl/frames/${f}.json`), 'frames');
    const n = d?.data?.length || 0;
    if (!n) throw new Error('frame has no rows');
    const aapl = d.data.find((x) => Number(x.cik) === 320193);
    return `rows=${n} AAPL=${aapl ? aapl.val : 'absent'}`;
  });
  await sleep(250);
}

section('EDGAR: company_tickers (CIK ↔ ticker for the universe)');
for (const u of ['https://www.sec.gov/files/company_tickers.json', 'https://www.sec.gov/files/company_tickers_exchange.json']) {
  await probe(`edgar ${u.split('/').pop()}`, async () => {
    const d = expect200(await http.get(u), 'company_tickers');
    const count = Array.isArray(d?.data) ? d.data.length : Object.keys(d || {}).length;
    if (!count) throw new Error('empty ticker table');
    return `entries=${count}`;
  });
}

section('EDGAR: full-text search (13F-HR filers named Berkshire, this year)');
await probe('edgar efts search', async () => {
  const d = expect200(
    await http.get('https://efts.sec.gov/LATEST/search-index', {
      params: { q: '"Berkshire Hathaway"', forms: '13F-HR', dateRange: 'custom', startdt: `${y}-01-01`, enddt: `${y}-12-31` },
    }),
    'efts'
  );
  const hits = d?.hits?.hits || [];
  if (!hits.length) throw new Error('search answered no hits');
  return `hits=${hits.length} first=${short(hits[0]?._source?.display_names, 80)}`;
});

// --------------------------------------------------------------- OpenFIGI
section('OpenFIGI: CINS vs CUSIP (the security-master ingest path)');
console.log(`  OPENFIGI_API_KEY ${process.env.OPENFIGI_API_KEY ? 'set' : 'NOT set (10 per batch, slower)'}`);
const ids = ['037833100', 'H1467J104', 'G25508105', '594918104'];
for (const idType of ['ID_CUSIP', 'ID_CINS']) {
  await probe(`openfigi ${idType}`, async () => {
    const out = await openfigiLookup(ids.map((idValue) => ({ idType, idValue })));
    if (!out) throw new Error('mapping request failed (null batch)');
    const resolved = out.filter(Boolean).length;
    return `${resolved}/${ids.length} resolved: ${ids.map((id, i) => `${id}=${out[i]?.ticker || '-'}`).join(' ')}`;
  });
  await sleep(1500);
}

// ------------------------------------------------------------ price chain
section('Price chain: each keyed provider, the same call the live /api/stock makes');
const PROVIDERS = [
  { name: 'fmp', env: 'FMP_API_KEY', has: hasFmp, run: fmpStock },
  { name: 'twelvedata', env: 'TWELVEDATA_API_KEY', has: hasTd, run: tdStock },
  { name: 'finnhub', env: 'FINNHUB_API_KEY', has: hasFinnhub, run: finnhubStock },
];
const keyed = PROVIDERS.filter((p) => p.has());
for (const p of PROVIDERS) if (!p.has()) console.log(`  skip ${p.name}: ${p.env} not set`);
for (const sym of SYMBOLS) {
  for (const p of keyed) {
    await probe(`${p.name} ${sym}`, async () => {
      const out = await p.run(sym);
      const px = out?.price?.price;
      if (!(px > 0)) throw new Error('answered without a price');
      return `price=${px} chg%=${out.price.changePercent ?? '-'} mcap=${out.price.marketCap ?? '-'} name=${out.price.name}`;
    });
  }
}

section('Price chain: the handler’s race (X-Stock-Chain as the live function would print it)');
for (const sym of SYMBOLS) {
  await probe(`race ${sym}`, async () => {
    const race = raceProviders(sym, { budgetMs: 8000, log: (m) => console.log(`       ${m}`) });
    const first = await race.withinBudget;
    await race.eventual;
    const chain = race.chain();
    if (!first) throw new Error(`no provider answered within budget: ${chain}`);
    return `served by ${first.provider} price=${first.data.price.price} chain=${chain}`;
  });
}
const health = snapshot().providers;
console.log(
  '  quota:',
  Object.entries(health)
    .map(([n, h]) => `${n} ${h.quota.usedToday}/${h.quota.limit ?? '∞'} per ${h.quota.per ?? '-'}${h.quota.exhausted ? ' EXHAUSTED' : ''}${h.open ? ' breaker-open' : ''}`)
    .join(' · ')
);

section('Daily closes (the chain behind /api/chart and /api/returns)');
for (const sym of SYMBOLS) {
  await probe(`closes ${sym}`, async () => {
    const series = await dailyCloses(sym);
    if (!series?.length) throw new Error('empty series');
    const last = series[series.length - 1];
    return `rows=${series.length} first=${series[0].date} last=${last.date} close=${last.close}`;
  });
}

// ---------------------------------------------------------------- summary
section('Summary');
const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(width)} ${String(r.ms).padStart(6)}ms  ${r.note}`);
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} probes ok`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [
    `## Market data probe — ${rows.length - failed.length}/${rows.length} ok`,
    '',
    '| probe | result | ms | note |',
    '|---|---|---:|---|',
    ...rows.map((r) => `| ${r.name} | ${r.ok ? '✅' : '❌'} | ${r.ms} | ${r.note.replace(/\|/g, '\\|')} |`),
    '',
  ].join('\n');
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

// The live quote board depends on this; nothing else here does.
const priceProbes = rows.filter((r) => keyed.some((p) => r.name.startsWith(`${p.name} `)));
if (keyed.length && priceProbes.length && priceProbes.every((r) => !r.ok)) {
  console.error(`\nevery keyed price provider failed (${keyed.map((p) => p.name).join(', ')}) — /api/stock would be answering from the snapshot`);
  process.exit(1);
}
if (!keyed.length) console.log('\nno price provider key is set — the price chain was not exercised');
console.log('probe done');
