// Read a deployed site (a Vercel preview or production) the way a visitor
// does and check the insider pages: every page answers 200, the default
// feed holds only open-market trades, the level labels are the descriptive
// ones, and the lines whose price cannot be checked (CX in pesos, DFDV's
// preferred stock, NCT after a reverse split) show no return.
//
//   node scripts/check-site.mjs https://www.fundocap.co
//
// Prints a report (markdown) and exits 1 on any failed check.
const base = String(process.argv[2] || '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node scripts/check-site.mjs <base url>');
  process.exit(2);
}
const headers = { 'User-Agent': 'fundocap-site-check', ...(process.env.VERCEL_BYPASS ? { 'x-vercel-protection-bypass': process.env.VERCEL_BYPASS } : {}) };
const get = async (p) => {
  const r = await fetch(base + p, { headers, redirect: 'follow' });
  const text = await r.text();
  return { status: r.status, text };
};
const out = [];
let failed = 0;
const check = (ok, what) => {
  out.push(`- ${ok ? '✅' : '❌'} ${what}`);
  if (!ok) failed++;
};

out.push(`## Site check — ${base}`, '');
for (const p of ['/tr', '/tr/insiders', '/tr/insiders/cluster', '/tr/insiders/penny', '/tr/stock/AAPL']) {
  const r = await get(p);
  check(r.status === 200, `${p} → HTTP ${r.status}`);
  if (r.status === 200 && /Güçlü sinyal/.test(r.text)) check(false, `${p} still says "Güçlü sinyal"`);
}

const feed = await get('/api/insider-feed?tab=latest');
if (feed.status !== 200) check(false, `/api/insider-feed → HTTP ${feed.status}`);
else {
  const j = JSON.parse(feed.text);
  const cats = [...new Set(j.rows.map((r) => r.category))];
  check(cats.every((c) => c === 'open_buy'), `default feed categories: ${cats.join(', ') || '—'} (open-market buys only)`);
  const levels = {};
  for (const r of j.rows) levels[r.signal?.level] = (levels[r.signal?.level] || 0) + 1;
  out.push(`- feed preview levels: ${JSON.stringify(levels)}`);
  out.push(`- feed preview rows: ${j.rows.map((r) => `${r.ticker} ${r.ret == null ? '—' : r.ret + '%'}${r.priceNote ? ` (${r.priceNote})` : ''}${r.holder ? ` [${r.holder}]` : ''}`).join(' · ')}`);
  for (const t of ['CX', 'DFDV', 'NCT'])
    for (const r of j.rows.filter((x) => x.ticker === t)) check(r.ret == null && r.priceUnverified, `${t} ${r.insider}: return ${r.ret ?? '—'}, note "${r.priceNote}", level ${r.signal?.level}`);
  out.push(`- /insiders cards: ${(j.stats?.signals || []).map((s) => `${s.ticker} ${s.kind} ${s.level} cost ${s.price} ret ${s.ret ?? '—'}`).join(' · ')}`);
  const lv = { strong: 0, medium: 1, weak: 2, none: 3 };
  const sig = j.stats?.signals || [];
  check(sig.every((s, i) => i === 0 || lv[sig[i - 1].level] <= lv[s.level]), 'cards list the higher label first');
  check(j.lastFilingDay != null, `newest filing day ${j.lastFilingDay}`);
}

const teaser = await get('/insiders-teaser.json');
if (teaser.status !== 200) check(false, `/insiders-teaser.json → HTTP ${teaser.status}`);
else {
  const t = JSON.parse(teaser.text);
  const all = [...(t.rows || []), ...(t.signals?.csuite || []), ...(t.signals?.penny || []), ...(t.penny?.rows || []), ...(t.penny?.signals || [])];
  for (const tk of ['CX', 'DFDV', 'NCT']) {
    const x = all.filter((r) => r.t === tk);
    if (x.length) check(x.every((r) => r.ret == null), `home/penny widgets: ${tk} ${x.length} row(s), return ${[...new Set(x.map((r) => r.ret ?? '—'))].join('/')}`);
  }
  out.push(`- home pulse: ${t.pulse?.day} · ${t.pulse?.buyCount} buys · $${t.pulse?.buyValue}`);
}

console.log(out.join('\n'));
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
