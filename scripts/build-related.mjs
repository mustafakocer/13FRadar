// "Related managers": for every curated guru, the five gurus with the
// highest Jaccard overlap of held tickers (latest quarter). Precomputed
// nightly (consensus.yml, after guru-history) into api/_data/related.json.
// Falls back to the public consensus holder lists when guru-history.json
// is not available yet, so the block never depends on a request-time join.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const load = (rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return null;
  }
};
const history = load('api/_data/guru-history.json');
const consensus = load('client/public/consensus.json') || { mostHeld: [], managers: [] };
const slugs = load('api/_data/slugs.json') || { byCik: {} };

const sets = new Map(); // cik -> Set(ticker|cusip)
const names = new Map();
if (history) {
  for (const [cik, g] of Object.entries(history.gurus)) {
    const last = g.quarters[g.quarters.length - 1]?.reportDate;
    const s = new Set();
    for (const [cusip, e] of Object.entries(g.positions)) if (e.series.some((r) => r[0] === last)) s.add(e.ticker || cusip);
    if (s.size) {
      sets.set(cik, s);
      names.set(cik, slugs.byCik[cik]?.name || g.name);
    }
  }
} else {
  for (const r of consensus.mostHeld) {
    for (const h of r.holders || []) {
      if (!sets.has(h.cik)) sets.set(h.cik, new Set());
      sets.get(h.cik).add(r.ticker || r.cusip);
      names.set(h.cik, slugs.byCik[h.cik]?.name || h.name);
    }
  }
}

const jaccard = (a, b) => {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
};
const out = { updatedAt: new Date().toISOString(), source: history ? 'guru-history' : 'consensus-most-held', related: {} };
for (const [cik, a] of sets) {
  const rows = [];
  for (const [other, b] of sets) {
    if (other === cik) continue;
    const shared = [...a].filter((x) => b.has(x));
    if (!shared.length) continue;
    rows.push({ cik: other, name: names.get(other), slug: slugs.byCik[other]?.slug || null, jaccard: Number(jaccard(a, b).toFixed(4)), shared: shared.slice(0, 8), sharedCount: shared.length });
  }
  rows.sort((x, y) => y.jaccard - x.jaccard || y.sharedCount - x.sharedCount);
  out.related[cik] = rows.slice(0, 5);
}
fs.writeFileSync(path.join(root, 'api', '_data', 'related.json'), JSON.stringify(out));
console.log(`related.json: ${Object.keys(out.related).length} managers (source: ${out.source})`);
