import axios from 'axios';
import { cached, TTL } from '../_lib/cache.js';
import { getSubmissions, list13F, getHoldings, padCik } from '../_lib/sec.js';
import { mapLimit } from '../_lib/yahooClient.js';
import { requirePro } from '../_lib/auth.js';

const UA = process.env.SEC_USER_AGENT || '13FRadar/1.0 (kocergpt@gmail.com)';

// GET /api/stock-ownership?cusip=037833100
// WhaleWisdom-style aggregate view: the largest 13F holders of one security,
// with shares/value/portfolio-weight and QoQ share change per fund.
// Filers are discovered via EDGAR full-text search on the CUSIP, then each
// filer's latest + previous holdings (long-cached) are inspected.
export default async function handler(req, res) {
  if (!(await requirePro(req, res))) return;
  const cusip = String(req.query.cusip || '').toUpperCase().trim();
  if (cusip.length < 8) return res.status(400).json({ error: 'Missing/invalid cusip' });

  try {
    const payload = await cached(`ownership:${cusip}`, TTL.HOUR_6, async () => {
      // discover filers reporting this CUSIP
      const byCik = new Map();
      let totalFilings = 0;
      for (const from of [0, 10, 20]) {
        const { data } = await axios.get('https://efts.sec.gov/LATEST/search-index', {
          timeout: 20000,
          headers: { 'User-Agent': UA },
          params: { q: `"${cusip}"`, forms: '13F-HR', from },
        });
        totalFilings = data?.hits?.total?.value ?? totalFilings;
        const hits = data?.hits?.hits || [];
        for (const h of hits) {
          for (const dn of h._source?.display_names || []) {
            const m = /^(.*?)\s*\(CIK\s+(\d+)\)\s*$/.exec(dn);
            if (m && !byCik.has(padCik(m[2]))) byCik.set(padCik(m[2]), m[1].trim());
          }
        }
        if (hits.length < 10) break;
      }

      const ciks = [...byCik.entries()].slice(0, 10);
      const rows = await mapLimit(ciks, 4, async ([cik, name]) => {
        const sub = await getSubmissions(cik);
        const fl = list13F(sub);
        if (!fl.length) return null;
        const cur = await getHoldings(cik, fl[0].acc, fl[0].filingDate);
        const pos = cur.positions.filter((p) => p.cusip === cusip && !p.putCall);
        if (!pos.length) return null;
        const shares = pos.reduce((s, p) => s + p.shares, 0);
        const value = pos.reduce((s, p) => s + p.value, 0);
        const weight = pos.reduce((s, p) => s + p.weight, 0);

        let dShares = null;
        let isNew = false;
        if (fl[1]) {
          try {
            const prev = await getHoldings(cik, fl[1].acc, fl[1].filingDate);
            const prevSh = prev.positions
              .filter((p) => p.cusip === cusip && !p.putCall)
              .reduce((s, p) => s + p.shares, 0);
            dShares = shares - prevSh;
            isNew = prevSh === 0;
          } catch {
            /* prev optional */
          }
        }
        return { cik, name: sub.name || name, reportDate: fl[0].reportDate, shares, value, weight, dShares, isNew };
      });

      const holders = rows.filter(Boolean).sort((a, b) => b.value - a.value);
      return {
        cusip,
        totalFilings,
        totalValue: holders.reduce((s, h) => s + h.value, 0),
        totalShares: holders.reduce((s, h) => s + h.shares, 0),
        holders,
      };
    });
    res.status(200).json(payload);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
}
