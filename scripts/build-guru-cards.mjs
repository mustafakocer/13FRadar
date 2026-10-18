// client/public/guru-cards.json — the home page's investor cards: one row
// per curated superinvestor still filing, with what a reader decides from at
// a glance (and nothing else): who, the firm, last year's return against the
// S&P 500, the portfolio's size, its three largest stocks and how many more.
//
//   node scripts/build-guru-cards.mjs
//
// Reads what the consensus job already produced — api/_lib/gurus.js (the
// registry), api/_data/slugs.json (URLs), api/_data/latest-holdings.json
// (value, count, top positions), api/_data/guru-stocks.json and
// client/public/stocks.json (CUSIP → ticker), api/_data/company-names.json
// (readable names) and api/_data/guru-performance.json (1Y return) — so it
// runs last in that chain. Nothing is fetched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GURUS, isActive, CATEGORIES } from '../api/_lib/gurus.js';
import { symbolOf } from '../api/_lib/logoScrape.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const data = path.join(root, 'api', '_data');
const pub = path.join(root, 'client', 'public');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// "Berkshire Hathaway (Warren Buffett)" → the person and the firm; a name
// with no bracket is the firm and the card leads with it. A bracket that
// also names the old firm ("DME Capital Management (Greenlight, David
// Einhorn)") gives the person after the last comma; "to Q1 2026" is a date.
const split = (name) => {
  const m = String(name).match(/^(.*?)\s*\((.+)\)\s*$/);
  return m ? { firm: m[1].trim(), person: m[2].split(',').map((x) => x.trim()).filter((x) => !/^to\s/i.test(x)).pop() || null } : { firm: name.trim(), person: null };
};

function main() {
  const slugs = readJson(path.join(data, 'slugs.json'))?.byCik || {};
  const holdings = readJson(path.join(data, 'latest-holdings.json'))?.byCik || {};
  const perf = readJson(path.join(data, 'guru-performance.json'))?.byCik || {};
  const names = readJson(path.join(data, 'company-names.json'))?.names || {};
  const tickerByCusip = new Map();
  for (const r of readJson(path.join(pub, 'stocks.json'))?.rows || []) if (r.cusip && r.ticker) tickerByCusip.set(r.cusip, r.ticker);
  for (const r of readJson(path.join(data, 'guru-stocks.json'))?.stocks || []) if (r.cusip && r.ticker && !tickerByCusip.has(r.cusip)) tickerByCusip.set(r.cusip, r.ticker);
  const readable = (ticker, issuer) => names[ticker] || names[symbolOf(ticker)] || issuer || ticker;

  const rows = [];
  for (const g of GURUS) {
    if (!isActive(g)) continue;
    const h = holdings[g.cik];
    if (!h) continue;
    const { firm, person } = split(g.name);
    const y1 = perf[g.cik]?.horizons?.y1;
    // the portfolio is the shares' value: an option line's 13F value is the
    // underlying's (Susquehanna 2026 Q2: $1.28T of which $1.17T options)
    const options = h.putCallValue || 0;
    const equity = Math.max(0, h.aum - options);
    const top = (h.top || [])
      .filter((p) => !p.putCall && tickerByCusip.has(p.cusip))
      .slice(0, 3)
      .map((p) => ({ t: tickerByCusip.get(p.cusip), n: readable(tickerByCusip.get(p.cusip), p.issuer), w: equity ? Number(((p.value / equity) * 100).toFixed(3)) : p.weight }));
    rows.push({
      cik: g.cik,
      slug: slugs[g.cik]?.slug || null,
      name: g.name,
      person,
      firm,
      category: CATEGORIES.includes(g.category) ? g.category : 'other',
      consensus: g.consensus !== false,
      reportDate: h.reportDate,
      aum: equity,
      ...(options ? { optionValue: options } : {}),
      count: h.count,
      y1: y1?.port ?? null,
      spy1: y1?.spy ?? null,
      top,
    });
  }
  // the registry's order is the "popular" order; the page sorts the rest itself
  const out = { updatedAt: new Date().toISOString(), count: rows.length, rows };
  fs.writeFileSync(path.join(pub, 'guru-cards.json'), JSON.stringify(out));
  const withPerf = rows.filter((r) => r.y1 != null).length;
  const withTop = rows.filter((r) => r.top.length === 3).length;
  console.log(`guru-cards: ${rows.length} funds · ${withPerf} with a 1Y return · ${withTop} with three named top holdings`);
}

main();
