// What the site needs to show a foreign company's Form 4 in US dollars:
// exchange rates, which issuers are foreign private issuers (FPIs), each
// one's ADR ratio, and the Form 4 fields of their older lines.
// Writes api/_data/fpi.json; api/_lib/fpiNormalize.js reads it.
//
//   node scripts/build-fpi.mjs                 update (needs network: FRED, SEC)
//   node scripts/build-fpi.mjs --report out.md also write the diagnosis/ratio tables
//   node scripts/build-fpi.mjs --refresh       re-check every issuer, not only stale ones
//
// Per step:
//   rates    from 30 days before the oldest insider line (api/_lib/fx.js):
//            the Federal Reserve's H.10 download (weekly, a week behind),
//            carried on with the ECB's newer days, then FRED for what is
//            still missing, each retried; a series still more than 3 days
//            behind is extended day by day from the open currency-api files. A series that cannot be read keeps what the file had;
//            one older than 7 days is an alarm (scripts/fx-stale-alarm.mjs).
//   issuers  SEC submissions JSON for every issuer in the insider data
//            (cached 30 days): FPI when it files 20-F, 40-F or 6-K; home
//            country and currency from the business address; ADR ratio
//            from the newest F-6 that states one, else the newest 20-F
//            cover page (api/_lib/adrRatio.js). Quote and URL are kept.
//   derived  for ADS issuers, the ratio implied by the stored US close on each
//            trade day (±10% of a common ratio), and whether it agrees.
//   closes   the stored US close on or after each FPI trade day, for tickers
//            the price cache does not hold — so the page can check a
//            conversion against the market.
//   raw      security title and footnotes of FPI lines filed before the raw
//            Form 4 fields were kept (re-read from EDGAR).
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { secGet, padCik, numCik } from '../api/_lib/sec.js';
import { FRED_SERIES, parseFredCsv, usdPerUnit, currencyOf, FED_H10_URL, parseFedH10Csv, ECB_URL, parseEcb, ECB_EXTRA, FALLBACK_SOURCE, FALLBACK_MAX_JUMP, fallbackUrls, parseCurrencyApi, extendSeries, staleRates } from '../api/_lib/fx.js';
import { statedRatio, deriveRatio } from '../api/_lib/adrRatio.js';
import { annualStatus } from '../api/_lib/annualForm.js';
import { loadDataset, currentRows, loadRaw, readJson, rowId } from '../api/_lib/insiderStore.js';
import { parseForm4Submission } from '../api/_lib/insiderForm4.js';
import { priceSnapshots } from '../api/_lib/marketData.js';
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
const MAX_RAW = Number(process.env.FPI_MAX_RAW || 6000);
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
const rateSource = { ...(prev.rateSource || {}) };
// Browsers' headers: FRED stalls requests that look like bots (every series
// hung ~100 s from GitHub's runners on the first run).
const web = axios.create({
  timeout: 45000,
  headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', Accept: 'text/csv,application/json,text/plain,*/*' },
  validateStatus: () => true,
  maxRedirects: 5,
});
const us = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// One source, up to `attempts` tries. A 200 whose body `valid` rejects (the
// Federal Reserve answered 200 with 0 bytes for weeks) counts as a failure.
async function tryGet(label, url, { attempts = 1, valid = (body) => String(body || '').length > 0, backoff = [5000, 15000], ...opts } = {}) {
  for (let i = 1; i <= attempts; i++) {
    const t0 = Date.now();
    const took = () => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
    const tag = attempts > 1 ? ` (try ${i}/${attempts})` : '';
    try {
      const r = await web.get(url, { responseType: 'text', transformResponse: [(x) => x], ...opts });
      const ok = r.status === 200 && valid(r.data);
      console.log(`  ${label}${tag}: HTTP ${r.status}, ${String(r.data || '').length} bytes, ${took()}${r.status === 200 && !ok ? ' — no usable data' : ''}`);
      if (ok) return r.data;
    } catch (e) {
      console.log(`  ${label}${tag}: ${e.code || e.message} after ${took()}`);
    }
    if (i < attempts) await wait(backoff[Math.min(i - 1, backoff.length - 1)]);
  }
  return null;
}
const got = new Set();
const keep = (series, src) => {
  for (const [cur, s] of Object.entries(series)) {
    if (!s.length || got.has(cur)) continue;
    rates[cur] = s;
    rateSource[cur] = src;
    got.add(cur);
  }
};
const missingRates = () => Object.keys(FRED_SERIES).filter((c) => !got.has(c));
// A series kept from a source, carried on with another source's newer days
// (api/_lib/fx.js extendSeries: weekdays, never a jump past 10%).
const extendTail = (cur, points, src) => {
  const { series, added, refused } = extendSeries(rates[cur], points);
  if (refused) console.warn(`::warning::${src}: ${refused} ${cur} rate(s) refused (more than ${FALLBACK_MAX_JUMP * 100}% from ${rates[cur].at(-1)[1]} on ${rates[cur].at(-1)[0]})`);
  if (!added) return 0;
  rates[cur] = series;
  rateSource[cur] = `${String(rateSource[cur] || '').split(' + ')[0] || 'H.10'} + ${src}`;
  got.add(cur);
  return added;
};
console.log('rates:');
// 1. the Federal Reserve Board's H.10 download (all currencies, one request)
const fed = await tryGet('Federal Reserve H.10', FED_H10_URL(us(from), us(today)), { attempts: 3, valid: (b) => Object.keys(parseFedH10Csv(b)).length > 0 });
if (fed) keep(parseFedH10Csv(fed), 'H.10');
// 2. the ECB reference rates: what H.10 lacks or did not deliver, and the
// days after H.10's last one (H.10 is published weekly, about a week behind:
// on its own it left every rate up to 8 days old)
const ecbWant = [...new Set([...Object.keys(FRED_SERIES), ...ECB_EXTRA])];
const ecb = await tryGet(`ECB (${ecbWant.length} currencies)`, ECB_URL(from, today, ecbWant), { attempts: 2, valid: (b) => { try { return Object.keys(parseEcb(JSON.parse(b))).length > 0; } catch { return false; } } });
if (ecb) {
  const series = parseEcb(JSON.parse(ecb));
  const fromH10 = Object.keys(series).filter((c) => got.has(c));
  keep(series, 'ECB');
  const added = fromH10.map((c) => [c, extendTail(c, series[c], 'ECB')]).filter(([, n]) => n);
  if (added.length) console.log(`  ECB after H.10's last day: ${added.map(([c, n]) => `${c} +${n}`).join(', ')}`);
}
// 3. FRED, the same H.10 series, for what is still missing (after the ECB
// that is only TWD and LKR: a small request, where all 22 series timed out)
const fredCsv = (ids, timeout) => tryGet(`FRED (${ids.join(',')})`, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${ids.join(',')}&cosd=${from}`, { attempts: 2, timeout, valid: (b) => /^observation_date|^DATE/i.test(String(b || '')) });
const keepFred = (csv) => {
  const lines = csv.split(/\r?\n/);
  const head = lines[0].split(',');
  for (const cur of missingRates()) {
    const [id, usdPer] = FRED_SERIES[cur];
    const col = head.indexOf(id);
    if (col < 0) continue;
    const one = lines.map((l) => { const f = l.split(','); return `${f[0]},${f[col] ?? ''}`; }).join('\n');
    keep({ [cur]: parseFredCsv(one, usdPer) }, 'H.10 (FRED)');
  }
};
if (missingRates().length) {
  const csv = await fredCsv(missingRates().map((c) => FRED_SERIES[c][0]), 90000);
  if (csv) keepFred(csv);
  // one series at a time when the batch failed
  if (missingRates().length > 1 && missingRates().length <= 4) for (const c of missingRates()) {
    const one = await fredCsv([FRED_SERIES[c][0]], 60000);
    if (one) keepFred(one);
  }
}
// 4. the open daily rates (api/_lib/fx.js FALLBACK_SOURCE) for a series
// still more than 3 days behind (TWD and LKR: H.10 only, a week behind), only
// after its last official day
const fallbackWant = Object.keys(FRED_SERIES).filter((c) => rates[c]?.length && rates[c].at(-1)[0] < addDays(today, -3));
if (fallbackWant.length) {
  const start = fallbackWant.map((c) => rates[c].at(-1)[0]).sort()[0];
  const days = [];
  for (let d = addDays(start, 1); d <= today && days.length < 45; d = addDays(d, 1)) days.push(d);
  const points = Object.fromEntries(fallbackWant.map((c) => [c, []]));
  let read = 0;
  for (const day of days) {
    let body = null;
    for (const url of fallbackUrls(day)) {
      try {
        const r = await web.get(url, { responseType: 'text', transformResponse: [(x) => x], timeout: 20000 });
        if (r.status === 200) body = JSON.parse(r.data);
      } catch {
        body = null;
      }
      if (body) break;
    }
    if (!body) continue;
    read++;
    for (const [cur, p] of Object.entries(parseCurrencyApi(body, fallbackWant))) points[cur].push(p);
  }
  console.log(`  ${FALLBACK_SOURCE}: ${read}/${days.length} day files read (${fallbackWant.join(', ')} since ${start})`);
  for (const cur of fallbackWant) {
    const n = extendTail(cur, points[cur], FALLBACK_SOURCE);
    if (n) console.log(`  ${cur}: ${n} day(s) from ${FALLBACK_SOURCE}, now to ${rates[cur].at(-1)[0]}`);
  }
}
const stillMissing = missingRates();
if (stillMissing.length) console.warn(`::warning::no fresh rate for ${stillMissing.join(', ')} — keeping what the file had`);
for (const s of staleRates(rates, today)) console.warn(`::warning::${s.cur} rate is ${s.days} days old (last ${s.last}) — scripts/fx-stale-alarm.mjs raises the alarm`);
console.log(`rates: ${got.size} currencies refreshed (${Object.entries(rateSource).filter(([c]) => got.has(c)).map(([c, s]) => `${c} ${s}`).join(', ')})`);

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
// companies that file 10-Ks now (a 10-K newer than their last 20-F/40-F):
// cik → that 10-K's date. No FPI rule touches their lines (fpiNormalize.js).
const tenK = { ...(prev.tenK || {}) };
const stale = (at) => !at || REFRESH || (Date.parse(today) - Date.parse(at)) / 86400000 > STALE_DAYS;
// an FPI read by an older version of the rules below is read again
const VERSION = 4;
const todo = [...byCik.keys()]
  .filter((cik) => stale(issuers[cik]?.checkedAt || domestic[cik]) || (issuers[cik] && (issuers[cik].v || 1) < VERSION))
  .slice(0, MAX_ISSUERS);
const DEBUG = new Set(String(process.env.FPI_DEBUG || '').split(',').filter(Boolean));
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

async function ratioFromFilings(cik, list, src, { range = false, debug = null } = {}) {
  for (const f of list) {
    if (!f.doc) continue;
    const url = docUrl(cik, f);
    try {
      const r = await secGet(url, { ...text, ...(range ? { headers: { Range: 'bytes=0-800000' } } : {}), maxContentLength: 150e6 });
      const body = docText(r.data).slice(0, range ? 400000 : undefined);
      const found = statedRatio(body);
      if (debug) {
        const hits = [...body.matchAll(/american depositary|\bADSs?\b/gi)].slice(0, 3).map((m) => body.slice(Math.max(0, m.index - 80), m.index + 200));
        console.log(`  [${debug}] ${src} ${url}: ${found ? `ratio ${found.ratio}` : 'no ratio'}${hits.length ? `\n    ${hits.join('\n    ')}` : ''}`);
      }
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
  // a foreign private issuer for the currency conversion: any 20-F, 40-F or
  // 6-K among the recent filings (unchanged). `lf`, the newest such filing's
  // date, drives the "Yabancı şirket" badge, which needs one in the last 24
  // months (fpiContext.isForeignWith) — the badge does not move conversions.
  const lf = filings.filter((f) => FPI_FORMS.test(f.form)).reduce((m, f) => (f.date > m ? f.date : m), '');
  // a 20-F in the history is not enough: the newest annual report decides.
  // A company that now files 10-Ks (Indivior, Merus, Summit) reports in
  // dollars, one share per share, like any US company: it is marked in
  // `tenK` and no FPI rule applies (fpiNormalize.js). Its issuer record is
  // kept, so the lines those rules used to convert still get the US
  // market check rather than none.
  const yearly = annualStatus(filings);
  const fpi = Boolean(lf);
  if (lf && yearly.status === 'domestic') tenK[cik] = yearly.tenK;
  else delete tenK[cik];
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
  const country =
    sub?.addresses?.business?.stateOrCountryDescription || sub?.addresses?.mailing?.stateOrCountryDescription || sub?.stateOfIncorporationDescription || null;
  const debug = DEBUG.has(e.t) ? e.t : null;
  // the newest annual report's cover first: it states the ratio in force
  // today, while an F-6 can be a decade old (Vipshop's 2012 F-6 says two
  // shares per ADS; it has been 0.2 share since)
  let ratio = annual.length ? await ratioFromFilings(cik, annual, '20f', { range: true, debug }) : null;
  if (!ratio && f6.length) ratio = await ratioFromFilings(cik, f6, 'f6', { debug });
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
    lf,
    checkedAt: today,
    v: VERSION,
  };
  if (++checked % 250 === 0) console.log(`  ${checked}/${todo.length}`);
}
for (const cik of Object.keys(issuers)) if (!byCik.has(cik)) delete issuers[cik];
for (const cik of Object.keys(domestic)) if (!byCik.has(cik)) delete domestic[cik];
for (const cik of Object.keys(tenK)) if (!byCik.has(cik)) delete tenK[cik];
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
// Only what the conversion reads: the security title and the footnotes that
// talk about currency, ADSs, ratios or prices — the file ships with the API.
const RELEVANT_NOTE = /currenc|dollar|peso|real|reais|yen|euro|pound|pence|franc|kron|rupee|won|yuan|renminbi|rmb|nt\$|hk\$|r\$|us\$|exchange rate|translated|converted|depositary|\bads\b|\badr|represent|per share|price/i;
function compactRaw(x) {
  if (!x) return null;
  const fn = Object.fromEntries(Object.entries(x.fn || {}).filter(([, t]) => RELEVANT_NOTE.test(t)).map(([k, t]) => [k, t.slice(0, 400)]));
  const out = { ...(x.st ? { st: x.st } : {}), ...(Object.keys(fn).length ? { fn } : {}) };
  return Object.keys(out).length ? out : { st: '' };
}
for (const [id, x] of Object.entries(fpiRaw)) fpiRaw[id] = compactRaw(x);
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
      const raw = m ? compactRaw(parsed.raw[`${acc}:${m.li}`]) : null;
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
// the US closes from the price store (Yahoo's chart used to answer this)
const { snapshots } = priceSnapshots(needCloses);
const closes = {};
for (const cik of fpiCiks) {
  const iss = issuers[cik];
  const list = fpiRows.filter((r) => r.ci === cik && r.p > 0 && r.t);
  const snap = list.length ? snapshots.get(list[0].t) : null;
  const series = snap?.closes?.length ? snap.closes : readSeries(list[0]?.t)?.prices || null;
  if (!series?.length) continue;
  const cached = Boolean(readSeries(list[0].t));
  // a home currency derived on an earlier run is derived again from scratch
  if (iss.curSrc === 'derived') {
    delete iss.cur;
    delete iss.curSrc;
  }
  const votes = new Map();
  const curVotes = new Map();
  let curTried = 0;
  const noteCur = (r) => {
    const x = rawStore[rowId(r)] || fpiRaw[rowId(r)];
    return x?.fn ? currencyOf(Object.values(x.fn).join(' ')) : null;
  };
  for (const r of list) {
    const bar = closeOnOrAfter(series, r.d);
    if (!bar || Date.parse(bar.date) - Date.parse(r.d) > 7 * 86400000) continue;
    if (!cached) (closes[r.t] ||= {})[bar.date] = bar.close;
    const stated = noteCur(r);
    // a note naming a currency is a vote for it (USD included)
    if (!iss.cur && stated) curVotes.set(stated, (curVotes.get(stated) || 0) + 1);
    if (!iss.cur && stated) curTried++;
    // home currency unknown (no address on file — Bradesco, TSMC): which
    // currency, at the documented ratio, puts this line at the close?
    if (!iss.cur && !stated) {
      curTried++;
      // a line already in dollars votes for USD: Sea and TSMC report in
      // dollars, and a currency "fitting" 20% off must not win over that
      // (per home share × ratio, or per ADS)
      const inUsd = [iss.ratio || 1, 1].some((k) => Math.abs((r.p * k) / bar.close - 1) <= 0.25);
      if (inUsd) curVotes.set('USD', (curVotes.get('USD') || 0) + 1);
      else for (const cu of Object.keys(rates)) {
        const px = r.p * usdPerUnit(cu, r.d, rates) * (iss.ratio || 1);
        if (px > 0 && Math.abs(px / bar.close - 1) <= 0.15) curVotes.set(cu, (curVotes.get(cu) || 0) + 1);
      }
    }
    if (!iss.ads) continue;
    for (const cu of stated ? [stated] : [iss.cur, 'USD']) {
      const ar = deriveRatio(bar.close, r.p, usdPerUnit(cu, r.d, rates));
      if (ar) votes.set(`${cu}|${ar}`, (votes.get(`${cu}|${ar}`) || 0) + 1);
    }
  }
  const topCur = [...curVotes.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!iss.cur && topCur && topCur[0] !== 'USD' && topCur[1] >= 3 && topCur[1] / curTried >= 0.8) {
    iss.cur = topCur[0];
    iss.curSrc = 'derived';
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
    rates: 'Federal Reserve H.10 (federalreserve.gov, else FRED); ECB reference rates for currencies H.10 does not publish. USD per unit.',
    issuers: 'SEC submissions; ADR ratio from the newest 20-F cover page, else the newest F-6 stating one',
  },
  rateSource,
  rates,
  issuers,
  domestic,
  tenK,
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
