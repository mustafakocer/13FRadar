// @ts-check
import axios from 'axios';
import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, numCik } from '../_lib/sec.js';
import { tickerToCik } from '../_lib/tickers.js';
import { parseForm4Xml } from '../_lib/form4.js';
import { requireFlag } from '../_lib/flags.js';
import * as v from '../_lib/validate.js';

const UA = process.env.SEC_USER_AGENT || '13FRadar/1.0 (kocergpt@gmail.com)';
const http = axios.create({ timeout: 20000, headers: { 'User-Agent': UA } });
const arr = (/** @type {any} */ x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** @param {string} cik @param {string} acc @param {string|null} filed */
export async function fetchForm4(cik, acc, filed) {
  const accNo = acc.replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNo}`;
  const { data: idx } = await http.get(`${base}/index.json`);
  const xml = arr(idx?.directory?.item).find((/** @type {any} */ i) => /\.xml$/i.test(i.name));
  if (!xml) return [];
  const { data: raw } = await http.get(`${base}/${xml.name}`, { responseType: 'text', transformResponse: [(d) => d] });
  return parseForm4Xml(raw, { acc, filed });
}

// GET /api/insiders/:ticker — recent Form 4 transactions for the issuer.
/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('insiders', res)) return;
  const ticker = v.ticker(req.query.ticker);
  if (!ticker) return v.bad(res, 'Missing or invalid ticker');
  try {
    const data = await cached(`insiders:${ticker}`, TTL.HOUR_6, async () => {
      const cik = await tickerToCik(ticker);
      if (!cik) return { transactions: [] };
      const sub = await getSubmissions(cik);
      const r = sub?.filings?.recent || {};
      /** @type {{ acc: string, filed: string }[]} */
      const filings = [];
      for (let i = 0; i < (r.form || []).length && filings.length < 12; i++) {
        if (r.form[i] === '4' || r.form[i] === '4/A') filings.push({ acc: r.accessionNumber[i], filed: r.filingDate[i] });
      }
      const nested = [];
      for (const f of filings) {
        try {
          nested.push(await fetchForm4(numCik(cik), f.acc, f.filed));
        } catch {
          /* skip unparseable filings */
        }
      }
      const transactions = nested
        .flat()
        .filter((t) => !t.derivative)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 25);
      return { cik, transactions };
    });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (/** @type {any} */ err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}
