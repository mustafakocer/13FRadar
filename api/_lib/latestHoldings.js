// The free view of every filer's latest 13F, precomputed.
//
// The weekly-then-daily universe build already reads every filer's newest
// info table to rank the universe by AUM. Keeping the ten largest positions
// and the totals from that pass (api/_data/latest-holdings.json) means a
// portfolio page can answer its free tier — top ten rows, true AUM and count
// — without going back to EDGAR for two requests and an XML parse on every
// CDN miss. A Pro request for the whole book, a specific set of CUSIPs, or
// any accession the snapshot does not hold still reads EDGAR as before.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let table;

export function latestHoldingsTable() {
  if (table === undefined) {
    try {
      const override = process.env.LATEST_HOLDINGS_FILE;
      table = override
        ? JSON.parse(fs.readFileSync(path.resolve(override), 'utf8'))
        : require('../_data/latest-holdings.json');
      if (!table?.byCik || typeof table.byCik !== 'object') table = null;
    } catch {
      table = null;
    }
  }
  return table;
}

// The stored snapshot for one filing, in the shape getHoldings answers, or
// null when the snapshot is for another accession (a newer filing landed
// since the build) or the filer is not in it.
export function latestHoldings(cik, acc) {
  const t = latestHoldingsTable();
  if (!t) return null;
  const e = t.byCik[String(cik).replace(/\D/g, '').padStart(10, '0')];
  if (!e || e.acc !== acc || !Array.isArray(e.top)) return null;
  return {
    aum: e.aum,
    count: e.count,
    filingDate: e.filed || null,
    reportDate: e.reportDate || null,
    ...(e.amendments?.length ? { amended: true, amendments: e.amendments } : {}),
    positions: e.top.map((p) => ({
      cusip: p.cusip,
      putCall: p.putCall || '',
      issuer: p.issuer || '',
      class: p.class || '',
      value: p.value,
      shares: p.shares,
      weight: p.weight,
    })),
    source: 'snapshot',
  };
}

// One filer's entry as the universe build stores it: the totals and the ten
// largest positions, rounded to what the table shows. `amendments` lists the
// 13F-HR/A documents folded into the snapshot, when there were any.
export function snapshotEntry({ acc, filed, reportDate = null, aum, positions, amendments = null }, top = 10) {
  return {
    acc,
    filed,
    ...(reportDate ? { reportDate } : {}),
    ...(amendments?.length ? { amendments: amendments.map((a) => ({ acc: a.acc, filingDate: a.filingDate, type: a.type })) } : {}),
    aum: Math.round(aum),
    count: positions.length,
    top: positions.slice(0, top).map((p) => ({
      cusip: p.cusip,
      ...(p.putCall ? { putCall: p.putCall } : {}),
      issuer: p.issuer,
      ...(p.class ? { class: p.class } : {}),
      value: Math.round(p.value),
      shares: Math.round(p.shares),
      weight: Number(p.weight.toFixed(3)),
    })),
  };
}
