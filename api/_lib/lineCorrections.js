// Lines a filer wrote ×10 and the nightly check corrected
// (api/_data/line-corrections.json, written by scripts/check-universe-audit.mjs;
// api/_lib/deviationFix.js says when). Read wherever a filing is read
// (sec.js getHoldings), so the fund page, the history and the universe agree.
import { createRequire } from 'node:module';
import { applyLineFixes } from './deviationFix.js';

const require = createRequire(import.meta.url);
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');

function load() {
  try {
    return require('../_data/line-corrections.json').corrections || [];
  } catch {
    return [];
  }
}
const byFiling = new Map();
for (const c of load()) {
  const k = `${pad(c.cik)}|${c.acc}`;
  if (!byFiling.has(k)) byFiling.set(k, []);
  byFiling.get(k).push(...(c.lines || []));
}

export const lineFixesFor = (cik, acc) => byFiling.get(`${pad(cik)}|${acc}`) || null;
export const withLineFixes = (agg, cik, acc) => {
  const fixes = lineFixesFor(cik, acc);
  return fixes ? applyLineFixes(agg, fixes) : agg;
};
