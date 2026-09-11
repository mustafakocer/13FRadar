// Quarterly report generator.
//   npm run report -- 2026 2        → api/_data/reports/2026-q2.json (page + API)
//                                     reports/2026-q2.md (distribution copy)
// Assembled from the precomputed consensus (buys/sells/new positions/update
// cards) and, when present, guru-history.json (prior-quarter holder counts
// for "new consensus positions"). No network access.
import fs from 'node:fs';
import path from 'node:path';
import { fmtMoney } from '../client/src/lib/format.js';
import { reportAnswer } from '../client/src/lib/reportText.js';

const [year, q] = process.argv.slice(2).map(Number);
if (!year || !q || q < 1 || q > 4) {
  console.error('usage: node scripts/build-report.mjs <yyyy> <quarter 1-4>');
  process.exit(1);
}
const root = process.cwd();
const load = (rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return null;
  }
};
const pro = load('api/_data/consensus-pro.json');
if (!pro) {
  console.error('api/_data/consensus-pro.json missing — run scripts/build-consensus.mjs first');
  process.exit(1);
}
const history = load('api/_data/guru-history.json');
const returns = load('client/public/returns.json')?.returns || {};
const quarterEnd = `${year}-${String(q * 3).padStart(2, '0')}-${q === 1 || q === 4 ? 31 : 30}`;
const id = `${year}-q${q}`;

const managers = pro.managers.filter((m) => m.reportDate === quarterEnd);
const updates = (pro.updates || []).filter((u) => u.reportDate === quarterEnd);
if (!managers.length) {
  console.error(`no tracked manager has a ${quarterEnd} filing in consensus-pro.json (latest: ${[...new Set(pro.managers.map((m) => m.reportDate))].sort().pop()})`);
  process.exit(1);
}
const row = (r) => ({ ticker: r.ticker || null, issuer: r.issuer, cusip: r.cusip, netValue: Math.round(r.netValue), buyers: r.buyers, sellers: r.sellers, holderCount: r.holderCount, totalValue: Math.round(r.totalValue), retYtd: r.ticker ? returns[r.ticker]?.retYtd ?? null : null });
const topBuysByValue = pro.topBought.slice(0, 20).map(row);
const topSellsByValue = pro.topSold.slice(0, 20).map(row);
const topBuysByCount = [...pro.topBought].sort((a, b) => b.buyers - a.buyers || b.netValue - a.netValue).slice(0, 20).map(row);
const topSellsByCount = [...pro.topSold].sort((a, b) => b.sellers - a.sellers || a.netValue - b.netValue).slice(0, 20).map(row);

// New consensus positions: held by ≥5 gurus now and <5 in the previous quarter
let newConsensus = null;
if (history) {
  const prevQ = (() => {
    const d = new Date(`${quarterEnd}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 3 + 1, 0);
    return d.toISOString().slice(0, 10);
  })();
  const now = new Map();
  const prev = new Map();
  for (const g of Object.values(history.gurus)) {
    for (const [cusip, e] of Object.entries(g.positions)) {
      const dates = new Set(e.series.map((r) => r[0]));
      if (dates.has(quarterEnd)) now.set(cusip, (now.get(cusip) || 0) + 1);
      if (dates.has(prevQ)) prev.set(cusip, (prev.get(cusip) || 0) + 1);
    }
  }
  const tick = new Map();
  for (const g of Object.values(history.gurus)) for (const [c, e] of Object.entries(g.positions)) if (!tick.has(c)) tick.set(c, { ticker: e.ticker, issuer: e.issuer });
  newConsensus = [...now.entries()]
    .filter(([c, n]) => n >= 5 && (prev.get(c) || 0) < 5)
    .map(([c, n]) => ({ cusip: c, ...tick.get(c), holderCount: n, prevHolderCount: prev.get(c) || 0 }))
    .sort((a, b) => b.holderCount - a.holderCount)
    .slice(0, 20);
}

const biggestExits = updates
  .flatMap((u) => u.exits.map((e) => ({ manager: u.manager, cik: u.cik, ticker: e.ticker, issuer: e.issuer, value: e.value })))
  .sort((a, b) => b.value - a.value)
  .slice(0, 15);
const notableMoves = updates
  .flatMap((u) => [
    ...u.adds.map((e) => ({ manager: u.manager, cik: u.cik, kind: 'add', ticker: e.ticker, issuer: e.issuer, change: e.change, value: e.value, weight: e.weight })),
    ...u.reduces.map((e) => ({ manager: u.manager, cik: u.cik, kind: 'reduce', ticker: e.ticker, issuer: e.issuer, change: e.change, value: e.value, weight: e.weight })),
  ])
  .filter((m) => m.change != null && Number.isFinite(m.change))
  .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
  .slice(0, 10);

const report = {
  id,
  year,
  quarter: q,
  quarterEnd,
  generatedAt: new Date().toISOString(),
  dataUpdatedAt: pro.updatedAt,
  managers: managers.map((m) => ({ name: m.name, cik: m.cik, filed: updates.find((u) => u.cik === m.cik)?.filed || null })),
  coverage: { onQuarter: managers.length, tracked: pro.managers.length },
  topBuysByValue,
  topSellsByValue,
  topBuysByCount,
  topSellsByCount,
  newConsensus,
  biggestExits,
  // TODO(schema ready): [{ sector, inflow, outflow, net }] once a ticker → sector
  // source exists (api/_data/ticker-meta.json is empty today; see issue #2)
  sectorFlow: null,
  notableMoves,
  newPositions: pro.newPositions.filter((n) => n.reportDate === quarterEnd).slice(0, 20),
};
report.answer = { en: reportAnswer(report, 'en'), tr: reportAnswer(report, 'tr') };

const dir = path.join(root, 'api', '_data', 'reports');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(report));
const ids = fs.readdirSync(dir).filter((f) => /^\d{4}-q[1-4]\.json$/.test(f)).map((f) => f.replace('.json', '')).sort().reverse();
fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ reports: ids }));

// markdown for distribution
const md = [];
const money = (v) => fmtMoney(v);
md.push(`# 13F Radar — Q${q} ${year} Superinvestor Report`);
md.push('');
md.push(`> ${report.answer.en}`);
md.push('');
md.push(`Generated ${report.generatedAt.slice(0, 10)} from SEC 13F-HR filings of ${managers.length} tracked funds (${managers.map((m) => m.name).join(', ')}). 13F data is delayed up to 45 days, long-only, US-listed. Not investment advice.`);
const table = (title, rows, cols) => {
  md.push('', `## ${title}`, '', `| ${cols.map((c) => c[0]).join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`);
  for (const r of rows) md.push(`| ${cols.map((c) => c[1](r)).join(' | ')} |`);
};
table('Top 20 net buys by $', topBuysByValue, [['Ticker', (r) => r.ticker || r.issuer], ['Company', (r) => r.issuer], ['Net bought', (r) => money(r.netValue)], ['Buyers', (r) => r.buyers], ['Holders', (r) => r.holderCount]]);
table('Top 20 net sells by $', topSellsByValue, [['Ticker', (r) => r.ticker || r.issuer], ['Company', (r) => r.issuer], ['Net sold', (r) => money(Math.abs(r.netValue))], ['Sellers', (r) => r.sellers], ['Holders', (r) => r.holderCount]]);
table('Top 20 buys by number of gurus', topBuysByCount, [['Ticker', (r) => r.ticker || r.issuer], ['Buyers', (r) => r.buyers], ['Net bought', (r) => money(r.netValue)]]);
table('Top 20 sells by number of gurus', topSellsByCount, [['Ticker', (r) => r.ticker || r.issuer], ['Sellers', (r) => r.sellers], ['Net sold', (r) => money(Math.abs(r.netValue))]]);
if (newConsensus) table('New consensus positions (≥5 gurus for the first time)', newConsensus, [['Ticker', (r) => r.ticker || r.issuer], ['Holders now', (r) => r.holderCount], ['Previous quarter', (r) => r.prevHolderCount]]);
else md.push('', '## New consensus positions', '', '_Requires guru-history.json (quarterly history precompute); not available at generation time._');
table('Biggest exits', biggestExits, [['Manager', (r) => r.manager], ['Ticker', (r) => r.ticker || r.issuer], ['Value sold', (r) => money(r.value)]]);
md.push('', '## Sector flow', '', '_TODO: ticker → sector source not wired yet (see issue #2)._');
table('Notable moves (largest % change in shares)', notableMoves, [['Manager', (r) => r.manager], ['Move', (r) => r.kind], ['Ticker', (r) => r.ticker || r.issuer], ['Change', (r) => `${r.change > 0 ? '+' : ''}${r.change.toFixed(1)}%`], ['Value', (r) => money(r.value)]]);
md.push('', `---`, `Source: 13F Radar · https://13fradar.com/en/reports/${id}`);
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports', `${id}.md`), md.join('\n') + '\n');
console.log(`report ${id}: ${managers.length}/${pro.managers.length} managers, ${topBuysByValue.length} buys, ${biggestExits.length} exits, ${notableMoves.length} notable moves${newConsensus ? `, ${newConsensus.length} new consensus` : ' (no history yet)'} → api/_data/reports/${id}.json, reports/${id}.md`);
