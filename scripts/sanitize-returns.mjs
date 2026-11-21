// Deploy-time repair of client/public/returns.json: the rows of symbols whose
// price file carries an earlier listing under the same ticker
// (api/_lib/priceStore.js listingStart) lose the figures that reach back
// before the current listing, so a deploy never publishes a return measured across two
// different securities (BSP: "year to date +2,779,900%") while it waits for
// the nightly build to rewrite the file.
//
// The nightly price build does the same for good (pricesBuild.js); once its
// rows are in, this finds nothing to change. It runs in the Vercel build only
// (vercel.json buildCommand), on the build's own checkout: a local
// `npm run build` does not touch the tracked file.
//
//   node scripts/sanitize-returns.mjs            rewrite the file where needed
//   SANITIZE_DRY=1 node scripts/sanitize-returns.mjs   print, write nothing
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSeries, withdrawAcrossListing } from '../api/_lib/priceStore.js';

// returns: { SYM: { ret1y, retYtd, ret1d, asOf } } → the symbols changed,
// [{ symbol, before, after }]. `read` is priceStore.readSeries. Nothing is
// recomputed: a figure whose window starts before the current listing is
// withdrawn (null — the pages print a dash), every other figure stays as the
// nightly build wrote it (priceStore.js withdrawAcrossListing, the rule the
// nightly build applies too).
export function sanitizeReturns(returns, { read = readSeries } = {}) {
  const changed = [];
  for (const [sym, row] of Object.entries(returns || {})) {
    const s = read(sym);
    if (!s?.skipped || !s.prices?.length || !row) continue;
    const next = withdrawAcrossListing(row.asOf ? row : { ...row, asOf: s.asOf }, s.prices[0].date);
    if (next.ret1y === row.ret1y && next.retYtd === row.retYtd) continue;
    changed.push({ symbol: sym, before: { ret1y: row.ret1y ?? null, retYtd: row.retYtd ?? null }, after: { ret1y: next.ret1y ?? null, retYtd: next.retYtd ?? null } });
    returns[sym] = next;
  }
  return changed;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const file = path.join(process.cwd(), 'client', 'public', 'returns.json');
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.log('sanitize-returns: no returns.json — nothing to do');
    process.exit(0);
  }
  const changed = sanitizeReturns(data.returns);
  for (const c of changed) console.log(`sanitize-returns: ${c.symbol} 1Y ${c.before.ret1y} → ${c.after.ret1y}, YTD ${c.before.retYtd} → ${c.after.retYtd}`);
  console.log(`sanitize-returns: ${changed.length} row(s) had a return measured across an earlier listing withdrawn`);
  if (changed.length && process.env.SANITIZE_DRY !== '1') fs.writeFileSync(file, JSON.stringify(data));
}
