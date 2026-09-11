import { createRequire } from 'node:module';
import { deadlines, currentPeriod, nextDeadline, inFilingSeason, todayIso } from '../_lib/calendar.js';
import { slugTable, filerPath } from '../_lib/slugs.js';
import { guruHistory } from '../_lib/history.js';

// GET /api/calendar — deadlines, per-guru status for the current period and
// recently received filings. Everything comes from the precomputed files;
// "recent" windows are relative to the universe file's own timestamp.
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
  const updateByCik = new Map((consensus.updates || []).map((u) => [u.cik, u]));

  const gurus = Object.entries(slugs.bySlug)
    .filter(([, v]) => v.kind === 'guru')
    .map(([slug, v]) => {
      const h = guruHistory(v.cik);
      const latest = h?.quarters?.[h.quarters.length - 1];
      const m = consensus.managers.find((x) => x.cik === v.cik);
      const u = updateByCik.get(v.cik);
      const reportDate = latest?.reportDate || u?.reportDate || m?.reportDate || null;
      const filed = latest?.filed || u?.filed || universe.rows.find((r) => r.cik === v.cik)?.filed || null;
      return {
        cik: v.cik,
        name: v.name,
        path: `/guru/${slug}`,
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
    recent: { asOf, last24h: recent(1), last7d: recent(7), universeCount: universe.rows.length },
  });
}
