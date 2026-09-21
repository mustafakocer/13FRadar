import { getSubmissions, list13F, padCik } from '../_lib/sec.js';
import { slugForCik, filerPath } from '../_lib/slugs.js';
import { guruHistory } from '../_lib/history.js';
import { latestHoldingsTable } from '../_lib/latestHoldings.js';
import { createRequire } from 'node:module';
import { reportIndex } from './report.js';

const require = createRequire(import.meta.url);
// the manager's quarter-over-quarter card from the daily consensus build
// (curated gurus only) — feeds the answer box's "biggest move"
function updateCard(cik) {
  try {
    const c = require('../../client/public/consensus.json');
    return (c.updates || []).find((u) => u.cik === cik) || null;
  } catch {
    return null;
  }
}

// What the committed data knows about a filer when EDGAR cannot be read: the
// nightly history's quarters (curated funds) or the universe build's latest
// filing. The page then renders from the snapshot it has instead of a 502 —
// the same day EDGAR throttles the region is the day readers come to look.
function offline(cik) {
  const id = padCik(cik);
  const g = guruHistory(id);
  if (g?.quarters?.length) {
    const filings = [...g.quarters].reverse().map((q) => ({
      acc: q.acc,
      form: '13F-HR',
      filingDate: q.filed,
      reportDate: q.reportDate,
      amended: Boolean(q.amended),
      amendments: q.amended || [],
    }));
    return { name: g.name, filings };
  }
  const e = latestHoldingsTable()?.byCik?.[id];
  if (e?.acc) {
    return {
      name: slugForCik(id)?.name || null,
      filings: [{ acc: e.acc, form: '13F-HR', filingDate: e.filed, reportDate: e.reportDate || null, amended: Boolean(e.amended), amendments: e.amendments || [] }],
    };
  }
  return null;
}

export default async function handler(req, res) {
  const cik = String(req.query.cik || '').replace(/\D/g, '');
  if (!cik) return res.status(400).json({ error: 'Missing CIK' });
  let sub = null;
  let filings;
  let source = 'edgar';
  try {
    sub = await getSubmissions(cik);
    // one entry per period of report, newest first, amendments attached —
    // never a 13F-HR/A shown as a quarter of its own
    filings = list13F(sub);
  } catch (err) {
    const fallback = offline(cik);
    if (!fallback) return res.status(502).json({ error: String(err.message || err) });
    console.warn(`manager ${cik}: EDGAR unavailable (${err.message}) — answering from stored data`);
    filings = fallback.filings;
    sub = { name: fallback.name, addresses: {} };
    source = 'stored';
  }
  res.setHeader('Cache-Control', source === 'edgar' ? 's-maxage=1800, stale-while-revalidate=86400' : 's-maxage=300, stale-while-revalidate=3600');
  const entry = slugForCik(cik);
  res.status(200).json({
    cik: padCik(cik),
    name: sub.name || entry?.name || `CIK ${padCik(cik)}`,
    displayName: entry?.kind === 'guru' ? entry.name : sub.name || entry?.name || `CIK ${padCik(cik)}`,
    slug: entry?.slug || null,
    kind: entry?.kind || 'filer',
    path: filerPath(cik),
    update: updateCard(padCik(cik)),
    latestReport: reportIndex()[0] || null,
    city: sub.addresses?.business?.city || null,
    state: sub.addresses?.business?.stateOrCountry || null,
    source,
    filings,
  });
}
