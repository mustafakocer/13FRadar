// A filing's changes against the filing before it — the data behind the
// guru page's FAQ and its "Changes" tab (GET /api/changes/:cik/:acc).
//
// The computation is portfolioChanges (client/src/lib/portfolioChanges.js);
// this only finds the two complete books to feed it:
//   · a curated guru: its stored 10-year history (guru-history.json), no
//     EDGAR read, so the server-rendered page can answer too. The history
//     keeps every security that ever ranked in the guru's top 100 with a row
//     for each quarter it was held, so a line missing from a quarter is a
//     real exit; for the widest books the smallest lines are not in it, and
//     the counts then come from the quarter's own totals (newCount /
//     exitCount, computed from the full filing).
//   · anyone else: both filings' effective snapshots from EDGAR.
import { guruHistory } from './history.js';
import { getSubmissions, list13F, getEffectiveHoldings } from './sec.js';
import { portfolioChanges } from '../../client/src/lib/portfolioChanges.js';

// The two books of one guru quarter and the one before, from the history.
export function historyBooks(g, reportDate) {
  const dates = (g?.quarters || []).map((q) => q.reportDate);
  const i = dates.indexOf(reportDate);
  if (i < 1) return null;
  const prevDate = dates[i - 1];
  const book = (d) => {
    const out = [];
    for (const [cusip, e] of Object.entries(g.positions || {})) {
      const r = (e.series || []).find((x) => x[0] === d);
      if (r) out.push({ cusip, ticker: e.ticker || null, issuer: e.issuer, shares: r[1], value: r[2], weight: r[3] });
    }
    return out;
  };
  return { current: book(reportDate), previous: book(prevDate), quarter: g.quarters[i], prevReportDate: prevDate };
}

export function changesFromHistory(g, reportDate) {
  const b = historyBooks(g, reportDate);
  if (!b) return null;
  const ch = portfolioChanges(b.current, b.previous);
  const q = b.quarter;
  // the full filing's own counts where the stored book is a subset
  const partial = q.count > b.current.length;
  return {
    ...ch,
    counts: {
      ...ch.counts,
      ...(partial && q.newCount != null ? { new: q.newCount } : {}),
      ...(partial && q.exitCount != null ? { exited: q.exitCount } : {}),
    },
    reportDate,
    prevReportDate: b.prevReportDate,
    source: 'history',
    ...(partial ? { partial: true } : {}),
  };
}

export async function changesFromEdgar(cik, acc) {
  const filings = list13F(await getSubmissions(cik));
  const i = filings.findIndex((f) => f.acc === acc || (f.amendments || []).some((a) => a.acc === acc));
  if (i < 0 || !filings[i + 1]) return null;
  const [cur, prev] = await Promise.all([getEffectiveHoldings(cik, filings[i]), getEffectiveHoldings(cik, filings[i + 1])]);
  return { ...portfolioChanges(cur.positions, prev.positions), reportDate: filings[i].reportDate, prevReportDate: filings[i + 1].reportDate, source: 'edgar' };
}

// reportDate lets a guru answer from the history without asking EDGAR which
// period the accession is.
export async function filingChanges(cik, acc, { reportDate = null } = {}) {
  const g = guruHistory(cik);
  if (g) {
    const date = reportDate || g.quarters.find((q) => q.acc === acc || (q.amended || []).some((a) => a.acc === acc))?.reportDate;
    if (date) {
      const ch = changesFromHistory(g, date);
      if (ch) return ch;
    }
  }
  return changesFromEdgar(cik, acc);
}
