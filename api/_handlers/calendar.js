import { createRequire } from 'node:module';
import { deadlines, currentPeriod, nextDeadline, inFilingSeason, todayIso } from '../_lib/calendar.js';
import { slugTable, filerPath } from '../_lib/slugs.js';
import { activeGurus, coverage } from '../_lib/gurus.js';
import { latestReports } from '../_lib/guruStatus.js';

// GET /api/calendar — deadlines, per-guru status for the current period and
// recently received filings. Everything comes from the precomputed files;
// "recent" windows are relative to the universe file's own timestamp.
//
// The gurus listed are the registry's funds active in the current period
// (api/_lib/gurus.js) — the same set every other page counts as "tracked" —
// with the latest period each has filed for read from the same status
// helper the consensus build uses for its coverage line.
const require = createRequire(import.meta.url);
const load = (f) => {
  try {
    return require(f);
  } catch {
    return null;
  }
};

export default function handler(req, res) {
  const now = new Date();
  const period = currentPeriod(now);
  const next = nextDeadline(now);
  const consensus = load('../../client/public/consensus.json') || { managers: [], updates: [] };
  const universe = load('../../client/public/universe.json') || { rows: [], updatedAt: null };
  const slugs = slugTable();
  const known = latestReports(consensus.managers || []);
  const updateByCik = new Map((consensus.updates || []).map((u) => [u.cik, u]));

  const gurus = activeGurus(period.quarterEnd)
    .map((g) => {
      const slug = slugs.byCik[g.cik]?.slug || null;
      const k = known.get(g.cik);
      const u = updateByCik.get(g.cik);
      const reportDate = k?.reportDate || u?.reportDate || null;
      const filed = k?.filed || u?.filed || universe.rows.find((r) => r.cik === g.cik)?.filed || null;
      return {
        cik: g.cik,
        name: g.name,
        category: g.category,
        path: slug ? `/guru/${slug}` : filerPath(g.cik),
        reportDate,
        filed,
        status: reportDate === period.quarterEnd ? 'filed' : reportDate ? 'pending' : 'unknown',
      };
    })
    .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'filed' ? -1 : 1));

  const asOf = universe.updatedAt ? universe.updatedAt.slice(0, 10) : todayIso(now);
  const cutoff = (days) => new Date(new Date(`${asOf}T00:00:00Z`).getTime() - days * 86400000).toISOString().slice(0, 10);
  const recent = (days) =>
    universe.rows
      .filter((r) => r.filed && r.filed >= cutoff(days))
      .sort((a, b) => b.filed.localeCompare(a.filed) || b.aum - a.aum)
      .slice(0, 100)
      .map((r) => ({ cik: r.cik, name: r.name, filed: r.filed, aum: r.aum, positions: r.positions, path: filerPath(r.cik) }));

  res.setHeader('Cache-Control', inFilingSeason(now) ? 's-maxage=3600, stale-while-revalidate=7200' : 's-maxage=86400, stale-while-revalidate=172800');
  res.status(200).json({
    today: todayIso(now),
    inSeason: inFilingSeason(now),
    period,
    next,
    daysToNext: Math.ceil((new Date(`${next.deadline}T00:00:00Z`) - now) / 86400000),
    deadlines: deadlines(now).filter((d) => d.quarterEnd >= `${now.getUTCFullYear() - 1}-12-31` && d.quarterEnd <= `${now.getUTCFullYear()}-12-31`),
    gurus,
    filedCount: gurus.filter((g) => g.status === 'filed').length,
    coverage: coverage(period.quarterEnd, new Map(gurus.map((g) => [g.cik, g.reportDate]))),
    recent: { asOf, last24h: recent(1), last7d: recent(7), universeCount: universe.rows.length },
  });
}
