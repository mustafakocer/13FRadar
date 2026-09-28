// Read a deployed site (a Vercel preview or production) the way a visitor
// does and check the insider pages: every page answers 200, the default
// feed holds only open-market trades, the level labels are the descriptive
// ones, foreign issuers' lines are in US dollars or clearly not (CX in
// pesos), DFDV's preferred stock has its own label and no return, NCT after
// a reverse split shows no return, and the home page ranks only lines with
// a verified dollar amount.
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
  // CX (pesos, CPOs): converted to US dollars per ADS, or — not verifiable —
  // shown in pesos with no dollar amount; never the old "$6,926,305"
  for (const r of j.rows.filter((x) => x.ticker === 'CX'))
    check(
      r.valueUnverified ? r.value == null && r.ret == null : r.currency === 'MXN' && r.value < 2e6,
      `CX ${r.insider}: ${r.valueUnverified ? `${r.currency} ${r.localValue} (USD karşılığı doğrulanamadı)` : `$${r.value} @ $${r.price}/ADS from ${r.currency} ${r.localPrice}, ratio ${r.adrRatio} (${r.ratioSource}), return ${r.ret ?? '—'}`}`
    );
  // DFDV: preferred stock — own label, no return from the common stock price
  for (const r of j.rows.filter((x) => x.ticker === 'DFDV')) check(r.ret == null && r.category === 'preferred', `DFDV ${r.insider}: ${r.category}, return ${r.ret ?? '—'}`);
  // NCT: no price history, 2× away from today's price — unchanged behaviour
  for (const r of j.rows.filter((x) => x.ticker === 'NCT')) check(r.ret == null && r.priceUnverified, `NCT ${r.insider}: return ${r.ret ?? '—'}, note "${r.priceNote}", level ${r.signal?.level}`);
  // "İsabet": a hidden rate is { unverified } or { insufficient }, never an empty "n="
  const badHit = j.rows.filter((r) => r.hitRate && r.hitRate.rate == null && !r.hitRate.unverified && !r.hitRate.insufficient);
  check(!badHit.length, `İsabet: ${badHit.length} row(s) with a rate-less value`);
  const fxRows = j.rows.filter((r) => r.currency || r.valueUnverified);
  out.push(`- foreign-currency rows in the preview: ${fxRows.map((r) => `${r.ticker} ${r.valueUnverified ? `${r.currency} ${r.localValue} (—)` : `$${r.value} ← ${r.currency}`}`).join(' · ') || '—'}`);
  out.push(`- /insiders day totals: buys $${j.stats?.buyValue} (${j.stats?.buyCount}) · sells $${j.stats?.sellValue} (${j.stats?.sellCount}) · excluded (currency not verified): ${j.stats?.fxExcluded ?? 0}`);
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
  // CX converted to dollars may show a return; unconverted, it may not
  for (const tk of ['CX', 'DFDV', 'NCT']) {
    const x = all.filter((r) => r.t === tk);
    const ok = (r) => (tk === 'CX' ? (r.v == null ? r.ret == null : r.v < 2e6) : r.ret == null);
    if (x.length) check(x.every(ok), `home/penny widgets: ${tk} ${x.length} row(s), value ${[...new Set(x.map((r) => r.v ?? '—'))].join('/')}, return ${[...new Set(x.map((r) => r.ret ?? '—'))].join('/')}`);
  }
  out.push(`- home pulse: ${t.pulse?.day} · ${t.pulse?.buyCount} buys · $${t.pulse?.buyValue}${t.pulse?.fxExcluded ? ` · ${t.pulse.fxExcluded} excluded (currency not verified)` : ''}`);
  const hl = t.highlight;
  out.push(`- home ÖNE ÇIKAN: ${hl ? `${hl.t} ${hl.n} $${hl.v}${hl.fx?.cu ? ` (from ${hl.fx.cu})` : ''}` : '—'}`);
  // an unconverted line never takes the highlight or a ranked slot
  const ranked = [hl, ...(t.signals?.csuite || []), ...(t.signals?.penny || [])].filter(Boolean);
  check(ranked.every((r) => r.v != null), 'home rankings: no line without a verified dollar amount');
  if (hl?.t === 'CX') check(hl.v < 2e6, `home ÖNE ÇIKAN CX in US dollars: $${hl.v}`);
  out.push(`- home clusters: ${(t.signals?.cluster || []).slice(0, 5).map((c) => `${c.t} ${c.insiders} insiders $${c.v}${c.fxExcluded ? ` (${c.fxExcluded} excluded)` : ''}`).join(' · ')}`);
}

console.log(out.join('\n'));
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
