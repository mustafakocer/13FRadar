import axios from 'axios';
import { parseStringPromise, processors } from 'xml2js';
import { cached, TTL } from './cache.js';

// SEC requires a descriptive User-Agent with contact info.
const UA = process.env.SEC_USER_AGENT || '13FRadar/1.0 (kocergpt@gmail.com)';

const http = axios.create({
  timeout: 25000,
  headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' },
});

export const padCik = (cik) => String(cik).replace(/\D/g, '').padStart(10, '0');
export const numCik = (cik) => String(Number(String(cik).replace(/\D/g, '')));

export function getSubmissions(cik) {
  const id = padCik(cik);
  return cached(`sub:${id}`, TTL.HOUR_1, async () => {
    const { data } = await http.get(`https://data.sec.gov/submissions/CIK${id}.json`);
    return data;
  });
}

// Extract the list of 13F-HR filings, one entry per report period. The entry
// is the original 13F-HR (its accession is the stable id used in URLs); any
// 13F-HR/A amendments for the same period are attached so holdings can be
// merged (see getFilingHoldings). Newest report period first.
export function list13F(sub) {
  const r = sub?.filings?.recent;
  if (!r) return [];
  const byPeriod = new Map();
  for (let i = 0; i < (r.form || []).length; i++) {
    const form = String(r.form[i]);
    if (!form.startsWith('13F-HR')) continue;
    const f = {
      acc: r.accessionNumber[i],
      form,
      filingDate: r.filingDate[i],
      reportDate: r.reportDate[i],
    };
    const g = byPeriod.get(f.reportDate) || { originals: [], amendments: [] };
    (form === '13F-HR/A' ? g.amendments : g.originals).push(f);
    byPeriod.set(f.reportDate, g);
  }
  const byDateDesc = (a, b) => (a.filingDate < b.filingDate ? 1 : -1);
  const out = [];
  for (const [reportDate, g] of byPeriod) {
    g.originals.sort(byDateDesc);
    g.amendments.sort(byDateDesc);
    // No original on record (rare): the earliest amendment stands in for it.
    const base = g.originals[0] || g.amendments.pop();
    if (!base) continue;
    const amendments = g.amendments
      .filter((a) => a.filingDate >= base.filingDate)
      .sort((a, b) => (a.filingDate < b.filingDate ? -1 : 1)) // oldest -> newest
      .map((a) => ({ acc: a.acc, filingDate: a.filingDate }));
    out.push({ ...base, reportDate, amendments, amended: amendments.length > 0 });
  }
  return out.sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
}

export async function fetchInfoTableXml(cik, acc) {
  const cikN = numCik(cik);
  const accNo = acc.replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${cikN}/${accNo}`;
  const { data: idx } = await http.get(`${base}/index.json`);
  let items = idx?.directory?.item || [];
  if (!Array.isArray(items)) items = [items];
  const xmls = items.filter(
    (i) => /\.xml$/i.test(i.name) && !/primary_doc/i.test(i.name)
  );
  if (!xmls.length) throw new Error('No information table XML found in filing');
  const pick =
    xmls.find((i) => /info/i.test(i.name)) ||
    xmls.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0))[0];
  const { data: xml } = await http.get(`${base}/${pick.name}`, {
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  return xml;
}

export async function parse13F(xml) {
  const doc = await parseStringPromise(xml, {
    explicitArray: false,
    ignoreAttrs: true,
    tagNameProcessors: [processors.stripPrefix],
  });
  let rows = doc?.informationTable?.infoTable || [];
  if (!Array.isArray(rows)) rows = [rows];
  return rows;
}

// Filings submitted on/after 2023-01-03 report values in whole dollars;
// earlier filings report in thousands (SEC rule amendment).
export function valueMultiplier(filingDate) {
  return filingDate && filingDate >= '2023-01-03' ? 1 : 1000;
}

export function aggregatePositions(rows, filingDate) {
  const mult = valueMultiplier(filingDate);
  const map = new Map();
  for (const r of rows) {
    const cusip = String(r.cusip || '').toUpperCase().trim();
    const putCall = (r.putCall || '').trim();
    const key = `${cusip}|${putCall}`;
    const value = (Number(r.value) || 0) * mult;
    const shares = Number(r.shrsOrPrnAmt?.sshPrnamt) || 0;
    const cur =
      map.get(key) || {
        cusip,
        putCall,
        issuer: r.nameOfIssuer || '',
        class: r.titleOfClass || '',
        value: 0,
        shares: 0,
      };
    cur.value += value;
    cur.shares += shares;
    map.set(key, cur);
  }
  const positions = [...map.values()].sort((a, b) => b.value - a.value);
  const aum = positions.reduce((s, p) => s + p.value, 0);
  for (const p of positions) p.weight = aum ? (p.value / aum) * 100 : 0;
  return { aum, positions };
}

// Raw holdings for one accession — cached long-term since filings are immutable.
export function getHoldings(cik, acc, filingDate) {
  return cached(`hold:${numCik(cik)}:${acc}`, TTL.DAY_7, async () => {
    const xml = await fetchInfoTableXml(cik, acc);
    const rows = await parse13F(xml);
    let fd = filingDate;
    if (!fd) {
      const sub = await getSubmissions(cik);
      fd = list13F(sub).find((f) => f.acc === acc)?.filingDate;
    }
    return aggregatePositions(rows, fd);
  });
}

// 13F-HR/A amendments come in two flavours (primary_doc.xml amendmentType):
//   RESTATEMENT  — a complete replacement of the original table
//   NEW HOLDINGS — only the additional positions (typically holdings that were
//                  kept confidential and disclosed later), to be ADDED to the
//                  original. Treating these as a full filing makes AUM collapse.
export function getAmendmentType(cik, acc) {
  return cached(`amtype:${numCik(cik)}:${acc}`, TTL.DAY_7, async () => {
    try {
      const cikN = numCik(cik);
      const accNo = acc.replace(/-/g, '');
      const { data: xml } = await http.get(
        `https://www.sec.gov/Archives/edgar/data/${cikN}/${accNo}/primary_doc.xml`,
        { responseType: 'text', transformResponse: [(d) => d] }
      );
      const m = /<amendmentType>\s*([^<]+?)\s*<\/amendmentType>/i.exec(xml);
      const type = m ? m[1].toUpperCase() : '';
      if (/RESTATEMENT/.test(type)) return 'RESTATEMENT';
      if (/NEW/.test(type)) return 'NEW HOLDINGS';
    } catch {
      /* fall through to heuristic */
    }
    return null;
  });
}

// Sum two aggregated position sets (same cusip|putCall keys are combined).
function mergeHoldings(a, b) {
  const map = new Map();
  for (const src of [a, b]) {
    for (const p of src.positions) {
      const key = `${p.cusip}|${p.putCall}`;
      const cur = map.get(key);
      if (cur) {
        cur.value += p.value;
        cur.shares += p.shares;
      } else {
        map.set(key, { ...p });
      }
    }
  }
  const positions = [...map.values()].sort((x, y) => y.value - x.value);
  const aum = positions.reduce((s, p) => s + p.value, 0);
  for (const p of positions) p.weight = aum ? (p.value / aum) * 100 : 0;
  return { aum, positions };
}

// Effective holdings for one report period: the original filing with its
// amendments applied. `filing` is an entry from list13F().
export function getFilingHoldings(cik, filing) {
  const amends = filing.amendments || [];
  if (!amends.length) return getHoldings(cik, filing.acc, filing.filingDate);
  const key = `holdq:${numCik(cik)}:${filing.acc}:${amends.map((a) => a.acc).join(',')}`;
  return cached(key, TTL.DAY_7, async () => {
    let base = await getHoldings(cik, filing.acc, filing.filingDate);
    for (const a of amends) {
      let amend;
      try {
        amend = await getHoldings(cik, a.acc, a.filingDate);
      } catch {
        continue; // an unreadable amendment must not take the whole quarter down
      }
      let type = await getAmendmentType(cik, a.acc);
      // Heuristic when primary_doc is unavailable: a table far smaller than the
      // original cannot be a full restatement.
      if (!type) type = amend.aum < base.aum * 0.5 ? 'NEW HOLDINGS' : 'RESTATEMENT';
      base = type === 'RESTATEMENT' ? amend : mergeHoldings(base, amend);
    }
    return base;
  });
}

// EDGAR full-text search (the backend behind efts.sec.gov/LATEST/search-index).
export async function ftsSearch(q, forms = '13F-HR') {
  const { data } = await http.get('https://efts.sec.gov/LATEST/search-index', {
    params: { q: `"${q}"`, forms },
  });
  return data;
}

// Classic company search fallback — returns atom XML we walk generically.
export async function companySearchAtom(q) {
  const { data } = await http.get('https://www.sec.gov/cgi-bin/browse-edgar', {
    params: {
      action: 'getcompany',
      company: q,
      type: '13F-HR',
      count: 40,
      output: 'atom',
    },
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  const doc = await parseStringPromise(data, {
    explicitArray: false,
    ignoreAttrs: true,
    tagNameProcessors: [processors.stripPrefix],
  });
  const found = new Map();
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    const cik = node.cik || node.CIK;
    const name = node['conformed-name'] || node.conformedName || node.name;
    if (cik && name && /^\d+$/.test(String(cik))) {
      found.set(padCik(cik), { cik: padCik(cik), name: String(name) });
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object') walk(v);
    }
  })(doc);
  return [...found.values()];
}
