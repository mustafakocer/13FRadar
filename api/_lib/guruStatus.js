// The latest period of report known for every tracked fund, from the files
// the builds commit — so a page can say how many of the tracked funds have
// filed for a quarter without asking EDGAR for a hundred submissions feeds.
//
// Sources, in order of trust:
//   1. what the caller already read from EDGAR this run (the consensus panel)
//   2. api/_data/guru-history.json — the last quarter row of each guru
//   3. client/public/universe.json + api/_data/filer-meta.json — the
//      filer's latest accession and the period that accession reports
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { historyTable } from './history.js';

const require = createRequire(import.meta.url);
const load = (rel, override) => {
  try {
    if (override) return JSON.parse(fs.readFileSync(path.resolve(override), 'utf8'));
    return require(rel);
  } catch {
    return null;
  }
};

const pad = (cik) => String(cik).replace(/\D/g, '').padStart(10, '0');

// Map cik → { reportDate, filed } for every fund the files know about,
// overlaid with `fresh` ([{ cik, reportDate, filed }]) from this run.
export function latestReports(fresh = []) {
  const out = new Map();
  const uni = load('../../client/public/universe.json', process.env.UNIVERSE_FILE);
  const meta = load('../_data/filer-meta.json', process.env.FILER_META_FILE);
  for (const r of uni?.rows || []) {
    const period = meta?.byCik?.[pad(r.cik)]?.reportByAcc?.[r.acc] || null;
    if (period) out.set(pad(r.cik), { reportDate: period, filed: r.filed || null });
  }
  const hist = historyTable();
  for (const [cik, g] of Object.entries(hist?.gurus || {})) {
    const last = g?.quarters?.[g.quarters.length - 1];
    if (!last?.reportDate) continue;
    const have = out.get(pad(cik));
    if (!have || last.reportDate > have.reportDate) out.set(pad(cik), { reportDate: last.reportDate, filed: last.filed || null });
  }
  for (const m of fresh) {
    if (!m?.cik || !m.reportDate) continue;
    const have = out.get(pad(m.cik));
    if (!have || m.reportDate >= have.reportDate) out.set(pad(m.cik), { reportDate: m.reportDate, filed: m.filed || null });
  }
  return out;
}

export const reportDatesByCik = (fresh = []) => new Map([...latestReports(fresh)].map(([cik, v]) => [cik, v.reportDate]));
