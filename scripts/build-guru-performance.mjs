// Chained 13F portfolio returns vs SPY for every curated guru
// (api/_lib/performance.js), written nightly after guru-history and the
// price cache (consensus.yml) into api/_data/guru-performance.json:
//
//   { updatedAt, asOf, byCik: { [cik]: { name, horizons, periods } } }
//
// /api/guru-performance reads this; the /gurus page sorts by it.
import fs from 'node:fs';
import path from 'node:path';
import { historyTable } from '../api/_lib/history.js';
import { tickerOfPosition } from '../api/_lib/historyResolve.js';
import { closeOn } from '../api/_lib/valueUnits.js';
import { readSeries } from '../api/_lib/priceStore.js';
import { guruPerformance } from '../api/_lib/performance.js';

const out = path.join(process.cwd(), 'api', '_data', 'guru-performance.json');
const table = historyTable();
if (!table?.gurus) {
  console.log('no guru-history.json — nothing to compute');
  process.exit(0);
}
const spy = readSeries('SPY');
const asOf = spy?.prices?.at(-1)?.date || null;
if (!asOf) {
  console.log('no SPY series on file — nothing to compare against');
  process.exit(0);
}

const byCik = {};
let withY1 = 0;
for (const [cik, g] of Object.entries(table.gurus)) {
  const perf = guruPerformance(g, { priceAt: closeOn, asOf, tickerOf: tickerOfPosition });
  byCik[cik] = { name: g.name, asOf: perf.asOf, current: perf.current, horizons: perf.horizons, periods: perf.periods.slice(-41) };
  if (perf.horizons.y1.port != null) withY1++;
}
fs.writeFileSync(out, JSON.stringify({ updatedAt: new Date().toISOString(), asOf, byCik }));
console.log(`guru-performance.json: ${Object.keys(byCik).length} gurus, ${withY1} with a 1Y figure, as of ${asOf}`);
