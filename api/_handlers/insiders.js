import axios from 'axios';
import { parseStringPromise, processors } from 'xml2js';
import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, numCik } from '../_lib/sec.js';
import { tickerToCik } from '../_lib/tickers.js';
import { requirePro } from '../_lib/auth.js';
import { readServed } from '../_lib/insiderStore.js';
import { categorize, classify } from '../_lib/insiderClassify.js';
import { dataFreshness } from '../../client/src/lib/secCalendar.js';

const UA = process.env.SEC_USER_AGENT || 'Fundocap/1.0 (kocergpt@gmail.com)';
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
    const code = tx.transactionCoding?.transactionCode || null;
    return {
      date: val(tx.transactionDate),
      owner: name,
      title: title || null,
      code,
      category: categorize({ k: code, p: price }),
      side: ad === 'A' ? 'buy' : ad === 'D' ? 'sell' : null,
      shares,
      price,
      value: price != null ? shares * price : null,
    };
  });
}

const TITLE = { director: 'Director', owner10: '10% Owner' };

// The same rows every other insider view reads (insiderStore), newest first.
// Each carries its category (insiderClassify.js) — the stock page prints
// "Opsiyon kullanımı", "Vergi kesintisi"… instead of calling an exercise a
// buy and a tax withholding a sale.
export function fromDataset(db, ticker, limit = 25) {
  return db.rows
    .filter((r) => r.t === ticker)
    .sort((a, b) => (a.d === b.d ? (a.f < b.f ? 1 : -1) : a.d < b.d ? 1 : -1))
    .slice(0, limit)
    .map((r) => {
      const c = classify(r);
      return {
        date: r.d,
        filed: r.f,
        owner: r.n,
        title: r.ti || TITLE[r.r] || null,
        code: r.k,
        category: c.category,
        ...(r.cp ? { compensationNote: r.cp } : {}),
        side: c.side,
        planned: c.plan_trade,
        shares: r.s,
        price: r.fx?.fail ? null : r.p,
        value: r.fx?.fail ? null : r.v,
        // a foreign issuer's line (fpiNormalize.js): converted, or kept in
        // its own currency with no dollar amount
        ...(r.fx?.fail ? { valueUnverified: true, currency: r.fx.cu || null, localValue: r.fx.lv, localPrice: r.fx.lp } : {}),
        ...(r.fx?.off != null ? { offMarket: r.fx.off } : {}),
        ...(r.fx?.ok && (r.fx.cu !== 'USD' || r.fx.ar !== 1) ? { currency: r.fx.cu, adrRatio: r.fx.ar, localPrice: r.fx.lp, ratioSource: r.fx.as } : {}),
      };
    });
}

// GET /api/insiders/:ticker — recent Form 4 transactions for the issuer.
//
// One insider pipeline: the answer comes from the nightly dataset, like the
// feed, the home page and the alerts. EDGAR is asked directly only as a
// fallback — when the dataset holds nothing for this ticker, or the dataset
// itself is stale (a crawl outage must not blank the stock page too).
export default async function handler(req, res) {
  if (!(await requirePro(req, res))) return;
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return res.status(400).json({ error: 'Missing ticker' });

  const db = readServed();
  const fresh = dataFreshness(db.lastFilingDay);
  const stored = fromDataset(db, ticker);
  if (stored.length && fresh.live) {
    const cik = db.rows.find((r) => r.t === ticker)?.ci || null;
    return res.status(200).json({ cik, transactions: stored, source: 'dataset', asOf: db.lastFilingDay });
  }

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
    res.status(200).json({ ...data, source: 'live' });
  } catch (err) {
    // EDGAR failed too: whatever the dataset has beats an error
    if (stored.length) return res.status(200).json({ cik: null, transactions: stored, source: 'dataset', asOf: db.lastFilingDay });
    res.status(502).json({ error: String(err.message || err) });
  }
}
