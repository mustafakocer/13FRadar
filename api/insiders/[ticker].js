import axios from 'axios';
import { parseStringPromise, processors } from 'xml2js';
import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, numCik } from '../_lib/sec.js';
import { tickerToCik } from '../_lib/tickers.js';

const UA = process.env.SEC_USER_AGENT || '13FRadar/1.0 (kocergpt@gmail.com)';
const http = axios.create({ timeout: 20000, headers: { 'User-Agent': UA } });

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const val = (x) => (x && typeof x === 'object' ? x.value : x) ?? null;

async function parseForm4(cik, acc) {
  const accNo = acc.replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${cik}/${accNo}`;
  const { data: idx } = await http.get(`${base}/index.json`);
  const items = arr(idx?.directory?.item);
  const xml = items.find((i) => /\.xml$/i.test(i.name));
  if (!xml) return [];
  const { data: raw } = await http.get(`${base}/${xml.name}`, {
    responseType: 'text',
    transformResponse: [(d) => d],
  });
  const doc = await parseStringPromise(raw, {
    explicitArray: false,
    ignoreAttrs: true,
    tagNameProcessors: [processors.stripPrefix],
  });
  const od = doc?.ownershipDocument;
  if (!od) return [];
  const owner = arr(od.reportingOwner)[0];
  const name = owner?.reportingOwnerId?.rptOwnerName || '—';
  const rel = owner?.reportingOwnerRelationship || {};
  const title =
    rel.officerTitle ||
    (val(rel.isDirector) === '1' || rel.isDirector === 'true' ? 'Director' : null) ||
    (val(rel.isTenPercentOwner) === '1' ? '10% Owner' : null);

  return arr(od.nonDerivativeTable?.nonDerivativeTransaction).map((tx) => {
    const shares = Number(val(tx.transactionAmounts?.transactionShares)) || 0;
    const price = Number(val(tx.transactionAmounts?.transactionPricePerShare)) || null;
    const ad = val(tx.transactionAmounts?.transactionAcquiredDisposedCode);
    return {
      date: val(tx.transactionDate),
      owner: name,
      title: title || null,
      code: tx.transactionCoding?.transactionCode || null,
      side: ad === 'A' ? 'buy' : ad === 'D' ? 'sell' : null,
      shares,
      price,
      value: price != null ? shares * price : null,
    };
  });
}

// GET /api/insiders/:ticker — recent Form 4 transactions for the issuer.
export default async function handler(req, res) {
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  try {
    const data = await cached(`insiders:${ticker}`, TTL.HOUR_6, async () => {
      const cik = await tickerToCik(ticker);
      if (!cik) return { transactions: [] };

      const sub = await getSubmissions(cik);
      const r = sub?.filings?.recent || {};
      const filings = [];
      for (let i = 0; i < (r.form || []).length && filings.length < 12; i++) {
        if (r.form[i] === '4') filings.push(r.accessionNumber[i]);
      }
      const nested = [];
      for (const acc of filings) {
        try {
          nested.push(await parseForm4(numCik(cik), acc));
        } catch {
          /* skip unparseable filings */
        }
      }
      const transactions = nested
        .flat()
        .filter((t) => t.date && t.shares > 0)
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .slice(0, 25);
      return { cik, transactions };
    });
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
