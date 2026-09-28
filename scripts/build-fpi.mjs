// What the site needs to show a foreign company's Form 4 in US dollars:
// exchange rates, which issuers are foreign private issuers (FPIs), each
// one's ADR ratio, and the Form 4 fields of their older lines.
// Writes api/_data/fpi.json; api/_lib/fpiNormalize.js reads it.
//
//   node scripts/build-fpi.mjs                 update (needs network: FRED, SEC, Yahoo)
//   node scripts/build-fpi.mjs --report out.md also write the diagnosis/ratio tables
//   node scripts/build-fpi.mjs --refresh       re-check every issuer, not only stale ones
//
// Per step:
//   rates    FRED, H.10 series (api/_lib/fx.js) from 30 days before the
//            oldest insider line. A series that cannot be read keeps what
//            the file had.
//   issuers  SEC submissions JSON for every issuer in the insider data
//            (cached 30 days): FPI when it files 20-F, 40-F or 6-K; home
//            country and currency from the business address; ADR ratio
//            from the newest F-6 that states one, else the newest 20-F
//            cover page (api/_lib/adrRatio.js). Quote and URL are kept.
//   derived  for ADS issuers, the ratio implied by the Yahoo close on each
//            trade day (±10% of a common ratio), and whether it agrees.
//   closes   the Yahoo close on or after each FPI trade day, for tickers
//            the price cache does not hold — so the page can check a
//            conversion against the market.
//   raw      security title and footnotes of FPI lines filed before the raw
//            Form 4 fields were kept (re-read from EDGAR).
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { secGet, padCik, numCik } from '../api/_lib/sec.js';
import { FRED_SERIES, fredUrl, parseFredCsv, usdPerUnit, currencyOf } from '../api/_lib/fx.js';
import { statedRatio, deriveRatio } from '../api/_lib/adrRatio.js';
import { loadDataset, currentRows, loadRaw, readJson, rowId } from '../api/_lib/insiderStore.js';
import { parseForm4Submission } from '../api/_lib/insiderForm4.js';
import { fetchCharts } from '../api/_lib/marketData.js';
import { readSeries } from '../api/_lib/priceStore.js';
import { closeOnOrAfter } from '../api/_lib/insiderOutcome.js';

const OUT = path.join(process.cwd(), 'api', '_data', 'fpi.json');
const REFRESH = process.argv.includes('--refresh');
const REPORT = (() => {
  const i = process.argv.indexOf('--report');
  return i > -1 ? process.argv[i + 1] : null;
})();
const STALE_DAYS = 30;
const MAX_ISSUERS = Number(process.env.FPI_MAX_ISSUERS || 6000);
const MAX_RAW = Number(process.env.FPI_MAX_RAW || 3000);
const now = new Date();
const today = now.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const text = { responseType: 'text', transformResponse: [(x) => x] };

const prev = readJson(OUT, {});
const db = loadDataset();
const rows = currentRows(db.rows);
const rawStore = loadRaw().rows || {};
console.log(`${rows.length} current insider lines, ${Object.keys(rawStore).length} with raw fields`);

// ------------------------------------------------------------------ rates
const oldest = rows.reduce((m, r) => (r.d && r.d < m ? r.d : m), today);
const from = addDays(oldest < '2024-01-01' ? '2024-01-01' : oldest, -30);
const rates = { ...(prev.rates || {}) };
const fred = axios.create({ timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0' }, validateStatus: () => true });
let rateFail = 0;
for (const [cur, [series, usdPer]] of Object.entries(FRED_SERIES)) {
  let ok = false;
  for (let attempt = 0; attempt < 3 && !ok; attempt++) {
    try {
      const r = await fred.get(fredUrl(series, from), text);
      if (r.status === 200) {
        const s = parseFredCsv(r.data, usdPer);
        if (s.length) {
          rates[cur] = s;
          ok = true;
        }
      }
    } catch {
      /* retried */
    }
    if (!ok) await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
  if (!ok) {
    rateFail++;
    console.warn(`::warning::FRED ${series} (${cur}) unavailable — keeping ${rates[cur]?.length || 0} stored rate(s)`);
  }
}
console.log(`rates: ${Object.keys(rates).length} currencies from ${from}${rateFail ? `, ${rateFail} kept from the last run` : ''}`);

// ------------------------------------------------------------------ issuers
// EDGAR business-address descriptions → currency
const COUNTRY_CUR = [
  [/taiwan/i, 'TWD'], [/mexico/i, 'MXN'], [/brazil/i, 'BRL'], [/hong kong/i, 'HKD'], [/china/i, 'CNY'],
  [/japan/i, 'JPY'], [/korea/i, 'KRW'], [/india\b/i, 'INR'], [/singapore/i, 'SGD'], [/united kingdom|england|scotland|wales|jersey|guernsey|isle of man/i, 'GBP'],
  [/switzerland/i, 'CHF'], [/sweden/i, 'SEK'], [/norway/i, 'NOK'], [/denmark/i, 'DKK'], [/canada|ontario|quebec|british columbia|alberta|manitoba|nova scotia|new brunswick|saskatchewan/i, 'CAD'],
  [/australia/i, 'AUD'], [/new zealand/i, 'NZD'], [/south africa/i, 'ZAR'], [/israel/i, 'ILS'], [/argentina/i, 'ARS'], [/chile/i, 'CLP'], [/colombia/i, 'COP'], [/peru/i, 'PEN'],
  [/thailand/i, 'THB'], [/malaysia/i, 'MYR'], [/philippines/i, 'PHP'], [/indonesia/i, 'IDR'], [/turkey|türkiye/i, 'TRY'],
  [/germany|france|netherlands|ireland|italy|spain|belgium|luxembourg|finland|austria|portugal|greece|cyprus|malta|estonia|latvia|lithuania|slovakia|slovenia|croatia/i, 'EUR'],
];
const curOfCountry = (desc) => COUNTRY_CUR.find(([re]) => re.test(desc || ''))?.[1] || null;
const FPI_FORMS = /^(20-F|40-F|6-K)(\/A)?$/;
const F6_FORMS = /^F-6/;

const byCik = new Map();
for (const r of rows) {
  if (!r.ci) continue;
  const e = byCik.get(r.ci) || { cik: r.ci, t: r.t, rows: [] };
  if (r.t) e.t = r.t;
  e.rows.push(r);
  byCik.set(r.ci, e);
}
const issuers = { ...(prev.issuers || {}) };
const domestic = { ...(prev.domestic || {}) };
const stale = (at) => !at || REFRESH || (Date.parse(today) - Date.parse(at)) / 86400000 > STALE_DAYS;
const todo = [...byCik.keys()].filter((cik) => stale(issuers[cik]?.checkedAt || domestic[cik])).slice(0, MAX_ISSUERS);
console.log(`issuers: ${byCik.size} in the data, ${todo.length} to (re)check at the SEC`);

const docText = (html) =>
  String(html || '')
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#822[01];|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/\s+/g, ' ');

function filingsOf(block) {
  if (!block?.form) return [];
  return block.form.map((form, i) => ({ form, date: block.filingDate[i], acc: block.accessionNumber[i], doc: block.primaryDocument[i] }));
}
const docUrl = (cik, f) => `https://www.sec.gov/Archives/edgar/data/${numCik(cik)}/${f.acc.replace(/-/g, '')}/${f.doc}`;

async function ratioFromFilings(cik, list, src, { range = false } = {}) {
  for (const f of list) {
    if (!f.doc) continue;
    const url = docUrl(cik, f);
    try {
      const r = await secGet(url, { ...text, ...(range ? { headers: { Range: 'bytes=0-800000' } } : {}), maxContentLength: 40e6 });
      const found = statedRatio(docText(r.data).slice(0, range ? 400000 : undefined));
      if (found) return { ratio: found.ratio, und: found.underlying, src, url, quote: found.quote.slice(0, 240), date: f.date };
    } catch (e) {
      console.warn(`  ${url}: ${e.response?.status || e.message}`);
    }
  }
  return null;
}

let checked = 0;
for (const cik of todo) {
  const e = byCik.get(cik);
  let sub;
  try {
    sub = (await secGet(`https://data.sec.gov/submissions/CIK${padCik(cik)}.json`)).data;
  } catch (err) {
    console.warn(`  CIK ${cik} (${e.t}): submissions ${err.response?.status || err.message}`);
    continue;
  }
  let filings = filingsOf(sub?.filings?.recent);
  const fpi = filings.some((f) => FPI_FORMS.test(f.form));
  if (!fpi) {
    domestic[cik] = today;
    delete issuers[cik];
    if (++checked % 250 === 0) console.log(`  ${checked}/${todo.length}`);
    continue;
  }
  delete domestic[cik];
  // an old ADR program's F-6 is often beyond the "recent" 1,000 filings
  if (!filings.some((f) => F6_FORMS.test(f.form))) {
    for (const page of (sub?.filings?.files || []).slice(0, 4)) {
      try {
        const more = (await secGet(`https://data.sec.gov/submissions/${page.name}`)).data;
        filings = filings.concat(filingsOf(more));
        if (filings.some((f) => F6_FORMS.test(f.form))) break;
      } catch {
        break;
      }
    }
  }
  const byDate = (a, b) => (a.date < b.date ? 1 : -1);
  const f6 = filings.filter((f) => F6_FORMS.test(f.form)).sort(byDate).slice(0, 4);
  const annual = filings.filter((f) => /^(20-F|40-F)$/.test(f.form)).sort(byDate).slice(0, 1);
  const country = sub?.addresses?.business?.stateOrCountryDescription || sub?.stateOfIncorporationDescription || null;
  let ratio = f6.length ? await ratioFromFilings(cik, f6, 'f6') : null;
  if (!ratio && annual.length) ratio = await ratioFromFilings(cik, annual, '20f', { range: true });
  // the issuer's own lines: which currency do their footnotes name?
  const votes = {};
  for (const r of e.rows) {
    const fn = rawStore[rowId(r)]?.fn;
    const c = fn ? currencyOf(Object.values(fn).join(' ')) : null;
    if (c && c !== 'USD') votes[c] = (votes[c] || 0) + 1;
  }
  const noted = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  issuers[cik] = {
    t: e.t,
    name: sub?.name || null,
    fpi: 1,
    country,
    cur: noted || curOfCountry(country),
    ads: f6.length || ratio ? 1 : 0,
    ...(ratio || {}),
    checkedAt: today,
  };
  if (++checked % 250 === 0) console.log(`  ${checked}/${todo.length}`);
}
for (const cik of Object.keys(issuers)) if (!byCik.has(cik)) delete issuers[cik];
for (const cik of Object.keys(domestic)) if (!byCik.has(cik)) delete domestic[cik];
const fpiCiks = Object.keys(issuers);
console.log(`FPIs: ${fpiCiks.length} (${fpiCiks.filter((c) => issuers[c].ads).length} with ADSs, ${fpiCiks.filter((c) => issuers[c].ratio).length} with a ratio from the SEC)`);

// ------------------------------------------------------------------ raw fields
const fpiRaw = { ...(prev.raw || {}) };
const fpiRows = rows.filter((r) => issuers[r.ci]);
const missing = new Map();
for (const r of fpiRows) {
  const id = rowId(r);
  if (rawStore[id] || fpiRaw[id]) continue;
  if (!missing.has(r.a)) missing.set(r.a, []);
  missing.get(r.a).push(r);
}
let rawAdded = 0;
let rawFetched = 0;
for (const [acc, list] of [...missing.entries()].slice(0, MAX_RAW)) {
  const r0 = list[0];
  const url = `https://www.sec.gov/Archives/edgar/data/${numCik(r0.ci)}/${acc}.txt`;
  try {
    const body = (await secGet(url, text)).data;
    const parsed = await parseForm4Submission(body, { filed: r0.f, path: url });
    rawFetched++;
    // stored lines from before line indexes were kept may number them
    // differently: match on the trade itself
    for (const r of list) {
      const m = parsed.rows.find((p) => p.d === r.d && p.k === r.k && p.s === r.s);
      const raw = m ? parsed.raw[`${acc}:${m.li}`] : null;
      if (raw) {
        fpiRaw[rowId(r)] = raw;
        rawAdded++;
      }
    }
  } catch (err) {
    console.warn(`  ${url}: ${err.response?.status || err.message}`);
  }
}
const liveIds = new Set(fpiRows.map(rowId));
for (const id of Object.keys(fpiRaw)) if (rawStore[id] || !liveIds.has(id)) delete fpiRaw[id];
console.log(`raw fields: ${rawFetched} of ${missing.size} FPI filing(s) re-read, ${rawAdded} line(s) filled`);

// ------------------------------------------------------------------ closes + derived ratio
const needCloses = [...new Set(fpiRows.map((r) => r.t).filter(Boolean))];
const { snapshots } = needCloses.length ? await fetchCharts(needCloses) : { snapshots: new Map() };
const closes = {};
for (const cik of fpiCiks) {
  const iss = issuers[cik];
  const list = fpiRows.filter((r) => r.ci === cik && r.p > 0 && r.t);
  const snap = list.length ? snapshots.get(list[0].t) : null;
  const series = snap?.closes?.length ? snap.closes : readSeries(list[0]?.t)?.prices || null;
  if (!series?.length) continue;
  const cached = Boolean(readSeries(list[0].t));
  const votes = new Map();
  for (const r of list) {
    const bar = closeOnOrAfter(series, r.d);
    if (!bar || Date.parse(bar.date) - Date.parse(r.d) > 7 * 86400000) continue;
    if (!cached) (closes[r.t] ||= {})[bar.date] = bar.close;
    if (!iss.ads) continue;
    for (const cu of [iss.cur, 'USD']) {
      const ar = deriveRatio(bar.close, r.p, usdPerUnit(cu, r.d, rates));
      if (ar) votes.set(`${cu}|${ar}`, (votes.get(`${cu}|${ar}`) || 0) + 1);
    }
  }
  const n = list.length;
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) {
    const [cu, ar] = best[0].split('|');
    iss.der = { ratio: Number(ar), cur: cu, n, agree: best[1] };
  } else delete iss.der;
}

const out = {
  updatedAt: now.toISOString(),
  sources: {
    rates: 'Federal Reserve H.10 via FRED (USD per unit)',
    issuers: 'SEC submissions; ratio from F-6 or 20-F cover page',
  },
  rates,
  issuers,
  domestic,
  closes: Object.fromEntries(Object.entries(closes).map(([t, m]) => [t, Object.entries(m).sort((a, b) => (a[0] < b[0] ? -1 : 1))])),
  raw: fpiRaw,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);

if (REPORT) {
  const { report } = await import('./fpi-report.mjs');
  const md = report();
  fs.writeFileSync(REPORT, md);
  console.log(md);
}
