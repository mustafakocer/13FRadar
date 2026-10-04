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

let feedClusters = null;
let feedStats = null;
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
  feedClusters = j.stats?.clusters || null;
  feedStats = j.stats || null;
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
  // "Piyasa Nabzı" and the /insiders summary: one function (daySummary), the same day and numbers
  if (feedStats && t.pulse) {
    const keys = ['day', 'buyCount', 'sellCount', 'buyValue', 'sellValue', 'sellShare'];
    const diff = keys.filter((k) => (t.pulse[k] ?? null) !== (feedStats[k] ?? null));
    check(!diff.length, `home pulse = /insiders summary (${keys.map((k) => `${k} ${t.pulse[k]}${diff.includes(k) ? ` ≠ ${feedStats[k]}` : ''}`).join(', ')})`);
  }
  out.push(`- home pulse: ${t.pulse?.day} · ${t.pulse?.buyCount} buys · $${t.pulse?.buyValue}${t.pulse?.fxExcluded ? ` · ${t.pulse.fxExcluded} excluded (currency not verified)` : ''}`);
  const hl = t.highlight;
  out.push(`- home ÖNE ÇIKAN: ${hl ? `${hl.t} ${hl.n} $${hl.v}${hl.fx?.cu ? ` (from ${hl.fx.cu})` : ''}` : '—'}`);
  // an unconverted line never takes the highlight or a ranked slot
  const ranked = [hl, ...(t.signals?.csuite || []), ...(t.signals?.penny || [])].filter(Boolean);
  check(ranked.every((r) => r.v != null), 'home rankings: no line without a verified dollar amount');
  if (hl?.t === 'CX') check(hl.v < 2e6, `home ÖNE ÇIKAN CX in US dollars: $${hl.v}`);
  // clusters (insiderCluster.js): the home table and /insiders/cluster read
  // signals.cluster; plan purchases and offerings are listed apart; a group
  // with no verified amount is not listed at all
  const cl = t.signals?.cluster || [];
  out.push(`- home clusters: ${cl.slice(0, 5).map((c) => `${c.t} ${c.insiders} insiders $${c.v}${c.ceoCfo ? ' CEO/CFO' : ''}${c.own != null ? ` own ${c.own}` : ''}`).join(' · ')}`);
  out.push(`- not counted as clusters: ${(t.signals?.clusterExcluded || []).slice(0, 10).map((e) => `${e.t} ${e.label} (${e.people})`).join(' · ') || '—'}`);
  check(cl.every((c) => c.v > 0 && c.insiders >= 2), 'every listed cluster has ≥2 counted people and a dollar total');
  check(!cl.some((c) => ['WIX', 'TSM', 'BBD'].includes(c.t)), 'WIX (no verified amount), TSM (employee plan) and BBD (one-price program) are not clusters');
  const bbd = (t.signals?.clusterExcluded || []).find((e) => e.t === 'BBD');
  if (bbd) check(bbd.label === 'program_same_price' && bbd.price > 0, `BBD listed apart: ${bbd.label} · ${bbd.people} people · ${bbd.cu} ${bbd.price} · spread ${bbd.maxDevPct}% · $${bbd.value}${bbd.fpi ? ' · foreign issuer' : ''}`);
  out.push(`- foreign-issuer badges: clusters ${cl.filter((c) => c.fpi).map((c) => c.t).join(', ') || '—'} · not counted ${(t.signals?.clusterExcluded || []).filter((e) => e.fpi).map((e) => e.t).join(', ') || '—'}`);
  if (feedClusters) check(JSON.stringify(feedClusters.map((c) => c.t)) === JSON.stringify(cl.map((c) => c.t)), `/insiders uses the same cluster list as the home page (${feedClusters.slice(0, 5).map((c) => c.t).join(', ')})`);
}

// The headline total and fund count: the file the browser reads, the
// definition (api/_lib/universeSummary.js on the served universe.json) and
// the number in the home page's server HTML must agree. A data run on older
// code once put $79.6T back in the file while the definition said $74.9T.
{
  const { universeSummaryFile } = await import('../api/_lib/universeSummary.js');
  const [sumR, uniR, homeR, priceR] = await Promise.all([get('/universe-summary.json'), get('/universe.json'), get('/tr'), get('/tr/pricing')]);
  if (sumR.status !== 200 || uniR.status !== 200) check(false, `/universe-summary.json → ${sumR.status}, /universe.json → ${uniR.status}`);
  else {
    const file = JSON.parse(sumR.text);
    out.push(`- universe-summary.json: \`${sumR.text.trim()}\``);
    const def = universeSummaryFile(JSON.parse(uniR.text));
    const off = def.totalAum ? Math.abs(file.totalAum / def.totalAum - 1) : 1;
    check(off <= 0.02, `universe-summary.json total $${(file.totalAum / 1e12).toFixed(2)}T vs the definition $${(def.totalAum / 1e12).toFixed(2)}T (${(off * 100).toFixed(2)}% apart, limit 2%)`);
    check(file.count === def.count && file.quarter === def.quarter && file.inTotal === def.inTotal, `universe-summary.json counts ${file.count} funds, ${file.inTotal} in ${file.quarter}; the definition ${def.count}, ${def.inTotal} in ${def.quarter}`);
    const shown = `$${Math.floor(def.totalAum / 1e12)}T+`;
    const count = def.count.toLocaleString('tr-TR');
    check(homeR.status === 200 && homeR.text.includes(shown), `home page server HTML shows ${shown}`);
    check(homeR.status === 200 && homeR.text.includes(count) && !/9\.000\+/.test(homeR.text), `home page server HTML shows ${count} funds (not a fixed "9.000+")`);
    // the pricing page states the same count ("Tam evren tarayıcı (8.909 fon)")
    const priced = priceR.text.match(/Tam evren tarayıcı \(([^)]*?) fon\)/)?.[1];
    check(priceR.status === 200 && priced === count, `/tr/pricing server HTML: "${priced ?? '(not found)'} fon" (the definition ${count})`);
  }
}

// C: the home page copy, as the server sends it, with the counts filled in
// from the data (the fund count, the gurus tracked).
{
  const plain = (h) => h.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
  for (const [lang, lead, cta, guru, why] of [
    ['tr', /ABD'deki ([\d.]+) fonun portföyünü[^.]*\. Her gün güncel, sade ve Türkçe\./, 'Ücretsiz hesap aç', /Takip ettiğimiz (\d+) ünlü yatırımcının[^.]*\./, 'Neden Fundocap?'],
    ['en', /We compile the portfolios of ([\d,]+) US funds[^.]*\. Updated daily, in plain language\./, 'Create a free account', /What the (\d+) famous investors[^.]*\./, 'Why Fundocap?'],
  ]) {
    const r = await get(`/${lang}`);
    const t = plain(r.text || '');
    const l = t.match(lead);
    const g = t.match(guru);
    check(r.status === 200 && l && g && t.includes(cta) && t.includes(why), `/${lang} copy: lead ${l?.[1] ?? '(missing)'} funds · "${cta}" · consensus ${g?.[1] ?? '(missing)'} gurus · "${why}"`);
    if (l) out.push(`- /${lang} lead: ${l[0]}`);
    if (g) out.push(`- /${lang} consensus: ${g[0]}`);
  }
}

// A1: a security that listed inside the quarter (IPO, spin-off) is held, not
// bought — the home page's net buys hold none of them (newListings.js).
{
  const { listingLookup, listedInQuarter } = await import('../client/src/lib/newListings.js');
  const [conR, listR] = await Promise.all([get('/consensus.json'), get('/new-listings.json')]);
  if (conR.status !== 200 || listR.status !== 200) check(false, `/consensus.json → ${conR.status}, /new-listings.json → ${listR.status}`);
  else {
    const con = JSON.parse(conR.text);
    const on = listingLookup(JSON.parse(listR.text));
    const q = con.quarter || con.coverage?.quarter;
    const buys = con.activity?.buys || [];
    const listed = buys.filter((r) => listedInQuarter(on(r.cusip) || on(r.ticker), q) && !(r.adders > 0 || r.sellers > 0));
    check(!listed.length, `home "En Çok Alınanlar" ${q}: ${buys.map((r) => r.ticker || r.cusip).join(', ')}${listed.length ? ` — listed in the quarter: ${listed.map((r) => r.ticker).join(', ')}` : ''}`);
  }
}

// A3: the stock page's guru count — the header and the history table agree
// for the newest quarter (guruStockHistory.js)
{
  const r = await get('/api/guru-stocks?ticker=TSM&range=all');
  if (r.status !== 200) check(false, `/api/guru-stocks?ticker=TSM → HTTP ${r.status}`);
  else {
    const j = JSON.parse(r.text);
    const last = j.trend?.quarters?.at(-1);
    check(Boolean(last) && last.reportDate === j.reportDate && last.holders === j.stock?.holderCount && last.value === Math.round(j.stock?.totalValue || 0), `TSM header ${j.stock?.holderCount} gurus $${j.stock?.totalValue} · table ${last?.reportDate} ${last?.holders} gurus $${last?.value}`);
  }
}

// B: the stock page's fundamentals come from SEC filings (fundamentals.json),
// with the filing they were read from; no average target price, no
// "veri sağlayıcıdan alınamıyor" banner
{
  const r = await get('/api/stock/AAPL');
  if (r.status !== 200) check(false, `/api/stock/AAPL → HTTP ${r.status}`);
  else {
    const sec = JSON.parse(r.text).sec || {};
    check(sec.eps != null && (typeof sec.pe === 'number' || sec.pe === 'loss') && sec.marketCap > 0 && /sec\.gov/.test(sec.src?.eps?.url || ''), `AAPL fundamentals: EPS ${sec.eps} · P/E ${sec.pe} · cap $${sec.marketCap} · ${sec.src?.eps?.form} ${sec.src?.eps?.end}`);
  }
  // a foreign filer, converted through the FX table (printed, not judged:
  // the rate table is refreshed by another job)
  const tsm = await get('/api/stock/TSM');
  if (tsm.status === 200) {
    const t = JSON.parse(tsm.text).sec || {};
    out.push(`- TSM fundamentals: EPS ${t.eps ?? '—'}${t.epsReason ? ` (${t.epsReason})` : ''} · P/E ${t.pe ?? '—'} · cap $${t.marketCap ?? '—'} · ${t.src?.eps?.form || ''} ${t.src?.eps?.end || ''}`);
  }
  const page = await get('/tr/stock/AAPL');
  check(page.status === 200 && !/veri sağlayıcıdan alınamıyor|Ort\. Hedef Fiyat/.test(page.text), 'stock page: no provider banner, no average target price');
}

// A filer whose newest 13F carries another filer's table opens on its newest
// valid quarter, with a note (config/misfiled-books.json, pageFiling).
{
  for (const [cik, label] of [['0001927315', 'Kingsbury'], ['0001812095', 'Sixth Street']]) {
    const r = await get(`/api/manager/${cik}`);
    if (r.status !== 200) {
      out.push(`- ${label}: /api/manager → HTTP ${r.status}`);
      continue;
    }
    const m = JSON.parse(r.text);
    const fb = m.fallback;
    const shown = (m.filings || []).find((f) => f.acc === m.defaultAcc);
    check(Boolean(fb) && m.defaultAcc && m.defaultAcc !== fb.misfiled.acc, `${label}: page opens on ${shown?.reportDate || '?'} (${m.defaultAcc}); ${fb ? `${fb.misfiled.reportDate} ${fb.misfiled.acc} carries ${fb.misfiled.copyOfName || fb.misfiled.copyOf}'s table` : 'no fallback'}`);
    const page = await get(`/tr${m.path || `/manager/${cik}`}`);
    const plain = page.text.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const note = plain.match(/Son geçerli bildirim: [^.]+\.[^;]+;/)?.[0];
    check(page.status === 200 && Boolean(note), `${label} page (/tr${m.path}): ${note || '(note not in the server HTML)'}`);
  }
}

// Launch audit 1: a stock page names the company beside its ticker — title,
// H1, meta description and the answer sentence — never "AAPL (AAPL)". The
// live quote (Finnhub) carries no name; api/_lib/companyNames.js adds it.
{
  const plain = (h) => h.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ').trim();
  for (const lang of ['tr', 'en']) {
    for (const t of ['AAPL', 'TSM', 'BRK-B', 'SLBT']) {
      const r = await get(`/${lang}/stock/${t}`);
      const title = plain(r.text.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || '');
      const h1 = plain(r.text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '');
      const desc = r.text.match(/<meta name="description" content="([^"]*)"/)?.[1] || '';
      const name = h1.replace(new RegExp(`\\s*\\(${t.replace('-', '[-.]')}\\)\\s*$`), '').trim();
      const self = `${t} (${t})`;
      check(
        r.status === 200 && name && name.toUpperCase() !== t && !title.includes(`${t} — ${t} `) && !desc.includes(self) && !r.text.includes(self),
        `/${lang}/stock/${t}: H1 "${h1}" · title "${title}"`
      );
    }
  }
}

// Launch audit 2: a fund's positions table names each company once in the
// server HTML (the phone layout draws it under the ticker from CSS)
{
  const r = await get('/tr/guru/berkshire-hathaway-warren-buffett');
  const m = await get('/api/manager/0001067983');
  if (r.status !== 200 || m.status !== 200) check(false, `Berkshire: page → HTTP ${r.status}, /api/manager → HTTP ${m.status}`);
  else {
    const plain = r.text.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const acc = JSON.parse(m.text).defaultAcc;
    const h = acc ? await get(`/api/holdings/0001067983/${acc}`) : { status: 0, text: '{}' };
    const top = h.status === 200 ? (JSON.parse(h.text).positions || []).slice(0, 3) : [];
    const doubled = top.filter((p) => p.issuer && plain.includes(`${p.issuer} ${p.issuer}`));
    check(top.length > 0 && !doubled.length, `Berkshire table, first rows: ${top.map((p) => `${p.ticker || '—'} · ${p.issuer}`).join(' | ')}${doubled.length ? ` — name written twice: ${doubled.map((p) => p.issuer).join(', ')}` : ''}`);
  }
}

// Old fund addresses (config/slug-aliases.json) answer a permanent redirect
// to the current page — /guru/berkshire-hathaway broke once when a data run
// shrank the redirect table.
for (const [from, to] of [['/tr/guru/berkshire-hathaway', '/tr/guru/berkshire-hathaway-warren-buffett'], ['/en/guru/berkshire-hathaway/changes', '/en/guru/berkshire-hathaway-warren-buffett/changes']]) {
  const r = await fetch(base + from, { headers, redirect: 'manual' });
  const loc = (r.headers.get('location') || '').replace(/^https?:\/\/[^/]+/, '');
  check(r.status === 301 && loc === to, `${from} → ${r.status} ${loc || '(no location)'}`);
}

console.log(out.join('\n'));
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
