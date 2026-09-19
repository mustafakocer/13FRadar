// One-off reachability and shape probe for the free data sources the batch
// builds could use, meant to run from a GitHub runner (the sandbox that writes
// the code cannot reach any of them). Prints, never writes.
//
//   node scripts/probe-market-data.mjs
import axios from 'axios';

const UA = process.env.SEC_USER_AGENT || 'Fundocap probe (kocergpt@gmail.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = axios.create({ timeout: 30000, validateStatus: () => true });
const section = (t) => console.log(`\n=== ${t} ===`);
const short = (x, n = 600) => JSON.stringify(x).slice(0, n);

// 1. EDGAR: where did Greenlight and Scion go?
section('EDGAR full-text search: 13F-HR filers named Greenlight / Scion since 2024');
for (const q of ['"Greenlight Capital"', '"Scion Asset Management"', 'Einhorn', 'Burry']) {
  const r = await http.get('https://efts.sec.gov/LatestSearch/', {
    params: { q, forms: '13F-HR', dateRange: 'custom', startdt: '2024-01-01', enddt: '2026-12-31' },
    headers: { 'User-Agent': UA },
  });
  console.log(`q=${q} HTTP ${r.status}`);
  const hits = r.data?.hits?.hits || [];
  const seen = new Map();
  for (const h of hits) {
    const s = h._source || {};
    const key = (s.ciks || []).join(',');
    if (!seen.has(key)) seen.set(key, { names: s.display_names, ciks: s.ciks, latest: s.file_date, period: s.period_ending, n: 0 });
    seen.get(key).n++;
  }
  for (const v of seen.values()) console.log('  ', short(v, 300));
  await sleep(300);
}
section('EDGAR submissions for the two known CIKs');
for (const cik of ['0001079114', '0001649339']) {
  const r = await http.get(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': UA } });
  const d = r.data || {};
  const rec = d.filings?.recent || {};
  const forms = rec.form || [];
  const last13f = forms.findIndex((f) => f === '13F-HR' || f === '13F-HR/A');
  const lastAny = 0;
  console.log(
    `CIK ${cik} HTTP ${r.status} name=${d.name} formerNames=${short(d.formerNames || [], 300)} ` +
      `last13F=${last13f >= 0 ? rec.filingDate[last13f] + ' ' + forms[last13f] : 'none'} ` +
      `lastAny=${forms.length ? rec.filingDate[lastAny] + ' ' + forms[lastAny] : 'none'}`
  );
  await sleep(300);
}
section('EDGAR company search (atom) by name');
for (const name of ['greenlight capital', 'scion asset']) {
  const r = await http.get('https://www.sec.gov/cgi-bin/browse-edgar', {
    params: { company: name, type: '13F-HR', action: 'getcompany', output: 'atom', count: 40 },
    headers: { 'User-Agent': UA },
  });
  const body = String(r.data || '');
  const entries = [...body.matchAll(/<title>([^<]+)<\/title>[\s\S]*?CIK=(\d+)/g)].map((m) => `${m[1]} (CIK ${m[2]})`);
  console.log(`${name}: HTTP ${r.status} ${entries.length ? entries.slice(0, 15).join(' | ') : body.slice(0, 300)}`);
  await sleep(300);
}

// 2. Yahoo chart from a runner: rate, fields.
section('Yahoo chart v8 (30 symbols, sequential)');
const syms = ['AAPL','MSFT','BRK-B','SPY','AMZN','GOOGL','META','NVDA','TSLA','JPM','V','UNH','XOM','PG','HD','MA','CVX','ABBV','PFE','KO','SPOT','ASML','NU','LIN','CRH','AON','ACN','TSM','BABA','QQQ'];
let t0 = Date.now();
let ok = 0;
for (const s of syms) {
  const r = await http.get(`https://query2.finance.yahoo.com/v8/finance/chart/${s}`, {
    params: { range: '1y', interval: '1d' },
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const res = r.data?.chart?.result?.[0];
  const m = res?.meta || {};
  const n = res?.timestamp?.length || 0;
  if (r.status === 200 && n) ok++;
  if (ok <= 3 || r.status !== 200)
    console.log(`  ${s}: HTTP ${r.status} points=${n} price=${m.regularMarketPrice} prevClose=${m.chartPreviousClose} type=${m.instrumentType} cur=${m.currency} exch=${m.exchangeName}`);
}
console.log(`  ok ${ok}/${syms.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
section('Yahoo chart v8 (30 symbols, concurrency 4)');
t0 = Date.now();
let ok4 = 0;
let s429 = 0;
await Promise.all(
  Array.from({ length: 4 }, async (_, w) => {
    for (let i = w; i < syms.length; i += 4) {
      const r = await http.get(`https://query2.finance.yahoo.com/v8/finance/chart/${syms[i]}`, {
        params: { range: '5d', interval: '1d' },
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (r.status === 200 && r.data?.chart?.result?.[0]) ok4++;
      if (r.status === 429) s429++;
    }
  })
);
console.log(`  ok ${ok4}/${syms.length}, 429s ${s429}, in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// 3. SEC XBRL frames: shares outstanding / public float for every filer in one call.
section('SEC XBRL frames');
for (const f of [
  'dei/EntityCommonStockSharesOutstanding/shares/CY2026Q2I',
  'dei/EntityCommonStockSharesOutstanding/shares/CY2026Q1I',
  'dei/EntityPublicFloat/USD/CY2025Q2I',
  'dei/EntityPublicFloat/USD/CY2026Q2I',
]) {
  t0 = Date.now();
  const r = await http.get(`https://data.sec.gov/api/xbrl/frames/${f}.json`, { headers: { 'User-Agent': UA } });
  const d = r.data || {};
  const rows = d.data || [];
  const aapl = rows.find((x) => Number(x.cik) === 320193);
  console.log(`  ${f}: HTTP ${r.status} rows=${rows.length} bytes~${JSON.stringify(d).length} ${(Date.now() - t0) / 1000}s AAPL=${short(aapl || null, 200)} first=${short(rows[0] || null, 200)}`);
  await sleep(300);
}
section('SEC submissions: SIC fields');
for (const cik of ['0000320193', '0000884394', '0001067983']) {
  const r = await http.get(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': UA } });
  const d = r.data || {};
  console.log(`  ${cik}: HTTP ${r.status} name=${d.name} sic=${d.sic} sicDescription=${d.sicDescription} tickers=${short(d.tickers)} exchanges=${short(d.exchanges)} category=${d.category} stateOfInc=${d.stateOfIncorporation}`);
  await sleep(300);
}
section('SEC company_tickers.json / company_tickers_exchange.json');
for (const u of ['https://www.sec.gov/files/company_tickers.json', 'https://www.sec.gov/files/company_tickers_exchange.json']) {
  const r = await http.get(u, { headers: { 'User-Agent': UA } });
  const d = r.data || {};
  const first = Array.isArray(d.data) ? d.data[0] : Object.values(d)[0];
  console.log(`  ${u}: HTTP ${r.status} fields=${short(d.fields || null, 200)} first=${short(first, 200)} count=${Array.isArray(d.data) ? d.data.length : Object.keys(d).length}`);
}

// 4. OpenFIGI: does ID_CINS resolve the foreign-domiciled names ID_CUSIP left blank?
section('OpenFIGI CINS vs CUSIP');
const cins = ['L8681T102', 'G25508105', 'N07059210', 'G6683N103', 'G54950103', 'G0403H108', 'G7997R103', 'G1151C101', 'H5919C104', 'H1467J104'];
const figiKey = process.env.OPENFIGI_API_KEY;
console.log(`  OPENFIGI_API_KEY ${figiKey ? 'set' : 'NOT set'}`);
for (const idType of ['ID_CINS', 'ID_CUSIP']) {
  const r = await http.post('https://api.openfigi.com/v3/mapping', cins.map((c) => ({ idType, idValue: c })), {
    headers: { 'Content-Type': 'application/json', ...(figiKey ? { 'X-OPENFIGI-APIKEY': figiKey } : {}) },
  });
  const out = Array.isArray(r.data)
    ? r.data.map((res, i) => `${cins[i]}=${res?.data?.find((d) => d.exchCode === 'US')?.ticker || res?.data?.[0]?.ticker || res?.error || 'none'}`)
    : short(r.data);
  console.log(`  ${idType}: HTTP ${r.status} ${Array.isArray(out) ? out.join(' ') : out}`);
  await sleep(3000);
}

// 5. FMP on the free plan: single-symbol calls.
section('FMP single-symbol (free plan check)');
const fmpKey = process.env.FMP_API_KEY;
if (!fmpKey) console.log('  FMP_API_KEY not set');
else {
  for (const [ep, sym] of [['profile', 'AAPL'], ['quote', 'AAPL'], ['profile', 'AAPL,MSFT']]) {
    const r = await http.get(`https://financialmodelingprep.com/stable/${ep}`, { params: { symbol: sym, apikey: fmpKey } });
    console.log(`  ${ep}?symbol=${sym}: HTTP ${r.status} ${short(r.data, 300).split(fmpKey).join('***')}`);
    await sleep(500);
  }
}

// 6. Stooq bulk quotes.
section('Stooq');
for (const u of [
  'https://stooq.com/q/l/?s=aapl.us+msft.us+spy.us&f=sd2t2ohlcv&h&e=csv',
  'https://stooq.com/q/d/l/?s=aapl.us&i=d',
]) {
  const r = await http.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' }, responseType: 'text', transformResponse: [(d) => d] });
  console.log(`  ${u}: HTTP ${r.status} ${String(r.data).slice(0, 300).replace(/\n/g, ' | ')}`);
}
console.log('\nprobe done');
