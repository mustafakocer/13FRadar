// @ts-check
import axios from 'axios';
import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, numCik } from '../_lib/sec.js';
import { tickerToCik } from '../_lib/tickers.js';
import { parseSchedule13Xml, holderTimeline } from '../_lib/schedule13.js';
import { getPlan } from '../_lib/plan.js';
import { requireFlag } from '../_lib/flags.js';
import * as v from '../_lib/validate.js';

const UA = process.env.SEC_USER_AGENT || '13FRadar/1.0 (kocergpt@gmail.com)';
const http = axios.create({ timeout: 20000, headers: { 'User-Agent': UA } });
const FORMS = new Set(['SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A', 'SCHEDULE 13D', 'SCHEDULE 13D/A', 'SCHEDULE 13G', 'SCHEDULE 13G/A']);
const MAX_PARSE = 15;
const FREE_ROWS = 3;

/** Structured (XML) schedules have a primary_doc.xml; older ones are HTML → link only.
 * @param {string} cik @param {{ acc: string, form: string, filingDate: string, url: string }} f */
async function fetchSchedule(cik, f) {
  if (!/^SCHEDULE/i.test(f.form)) return parseSchedule13Xml('', f);
  try {
    const { data: xml } = await http.get(`${f.url}primary_doc.xml`, { responseType: 'text', transformResponse: [(d) => d], validateStatus: () => true });
    return parseSchedule13Xml(typeof xml === 'string' ? xml : '', f);
  } catch {
    return parseSchedule13Xml('', f);
  }
}

// GET /api/filings13dg/:ticker — Schedule 13D/G timeline for the issuer.
// Free: newest 3 entries (links only). Pro: 15 parsed entries + holder timeline.
/** @param {any} req @param {any} res */
export default async function handler(req, res) {
  if (!requireFlag('filings13dg', res)) return;
  const ticker = v.ticker(req.query.ticker);
  if (!ticker) return v.bad(res, 'Missing or invalid ticker');
  try {
    const plan = await getPlan(req);
    const data = await cached(`13dg2:${ticker}`, TTL.HOUR_6, async () => {
      const cik = await tickerToCik(ticker);
      if (!cik) return { filings: [], holders: [] };
      const sub = await getSubmissions(cik);
      const r = sub?.filings?.recent || {};
      /** @type {{ acc: string, form: string, filingDate: string, url: string }[]} */
      const list = [];
      for (let i = 0; i < (r.form || []).length && list.length < MAX_PARSE; i++) {
        if (!FORMS.has(String(r.form[i]).toUpperCase())) continue;
        const acc = r.accessionNumber[i];
        list.push({ form: r.form[i], filingDate: r.filingDate[i], acc, url: `https://www.sec.gov/Archives/edgar/data/${numCik(cik)}/${acc.replace(/-/g, '')}/` });
      }
      const filings = [];
      for (const f of list) filings.push(await fetchSchedule(numCik(cik), f));
      return { cik, filings, holders: holderTimeline(filings) };
    });
    res.setHeader('Cache-Control', 'private, no-store');
    if (plan === 'free') {
      return res.status(200).json({ cik: data.cik, plan, filings: data.filings.slice(0, FREE_ROWS).map((/** @type {any} */ f) => ({ acc: f.acc, form: f.form, filingDate: f.filingDate, url: f.url, activist: f.activist, amendment: f.amendment })), holders: [], truncated: data.filings.length > FREE_ROWS });
    }
    res.status(200).json({ ...data, plan, truncated: false });
  } catch (/** @type {any} */ err) {
    res.status(502).json({ error: String(err?.message || err) });
  }
}
