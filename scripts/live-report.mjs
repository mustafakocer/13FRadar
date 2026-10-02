// What the live site says (commits nothing; diag-filings.yml): the home
// page's headline total and tooltip, TSM's ownership trend, Berkshire's
// latest changes.
const BASE = process.env.SITE_URL || 'https://www.fundocap.co';
const get = async (p, as = 'json') => {
  const r = await fetch(`${BASE}${p}`, { headers: { 'user-agent': 'fundocap-live-report' } });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  return as === 'json' ? r.json() : r.text();
};
const show = async (label, fn) => {
  try {
    console.log(`\n### ${label}\n${await fn()}`);
  } catch (e) {
    console.log(`\n### ${label}\nFAILED ${e.message}`);
  }
};
await show('insider teaser: ÖNE ÇIKAN, day totals, sentiment', async () => {
  const t = await get('/insiders-teaser.json');
  const p = t.pulse || {};
  const h = t.highlight || {};
  const buyShare = p.buyValue + p.sellValue > 0 ? ((p.buyValue / (p.buyValue + p.sellValue)) * 100).toFixed(1) : 'NA';
  return `updatedAt ${t.updatedAt}; day ${p.day}\nhighlight ${h.t} ${h.n} (${h.r}) ${h.d} v=${h.v} p=${h.p}\nbuys ${p.buyCount} = $${p.buyValue}; sells ${p.sellCount} = $${p.sellValue}; buy share ${buyShare}%, sell share ${p.sellShare}%; excluded ${p.fxExcluded || 0}`;
});
await show('universe-summary.json', async () => JSON.stringify(await get('/universe-summary.json')));
await show('home page tooltip', async () => {
  const html = await get('/', 'text');
  const m = html.match(/[^<>"]{0,200}opsiyonlar hariç[^<>"]{0,200}/g) || html.match(/[^<>"]{0,200}options excluded[^<>"]{0,200}/gi) || [];
  return m.slice(0, 3).join('\n') || '(no tooltip text in the served HTML)';
});
await show('TSM ownership trend', async () => {
  const d = await get('/api/guru-stocks?ticker=TSM&range=all');
  const q = d.trend?.quarters || d.trend || [];
  return (Array.isArray(q) ? q : []).map((x) => JSON.stringify(x)).join('\n');
});
await show('Berkshire changes 2026-Q2', async () => {
  const d = await get('/api/changes/0001067983/0001193125-26-352200');
  const l = (k) => (d[k] || []).map((x) => `${x.ticker || x.issuer}${x.pct != null ? ` ${x.pct}%` : ''}`).join(', ');
  return `counts ${JSON.stringify(d.counts)}\nnew: ${l('new')}\nadded: ${l('added')}\nreduced: ${l('reduced')}\nexited: ${l('exited')}`;
});
