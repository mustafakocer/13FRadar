// Generates /llms.txt and /llms-full.txt (llmstxt.org) at build time from the
// precomputed data files, so the content tracks the daily data refresh and
// never goes stale. Written into client/dist so Vercel serves them as static
// files before any rewrite.
//
//   node scripts/build-llms.mjs            (part of `npm run build`)
import fs from 'node:fs';
import path from 'node:path';
import { siteUrl } from '../api/_lib/site.js';
import { slugTable } from '../api/_lib/slugs.js';
import { historyTable } from '../api/_lib/history.js';
import { guruAnswerFromHistory, biggestMove } from '../client/src/lib/answerBox.js';
import { fmtMoney } from '../client/src/lib/format.js';
import { GUIDES, COMPARES } from '../client/src/content/registry.js';

const root = process.cwd();
const out = path.join(root, 'client', 'dist');
const site = siteUrl();
const load = (rel) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
  } catch {
    return null;
  }
};
const consensus = load('client/public/consensus.json') || { managers: [], mostHeld: [], updates: [] };
const stocks = load('client/public/stocks.json') || { rows: [] };
const teaser = load('client/public/insiders-teaser.json');
const summary = load('client/public/universe-summary.json');
const slugs = slugTable();
const history = historyTable();
const reports = fs.existsSync(path.join(root, 'api', '_data', 'reports'))
  ? fs.readdirSync(path.join(root, 'api', '_data', 'reports')).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort().reverse()
  : [];

const latestReport = (consensus.managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');
const updatedAt = (consensus.updatedAt || new Date().toISOString()).slice(0, 10);
const url = (lang, p) => `${site}/${lang}${p === '/' ? '' : p}`;
const link = (lang, p, label, note = '') => `- [${label}](${url(lang, p)})${note ? `: ${note}` : ''}`;

const gurus = Object.entries(slugs.bySlug)
  .filter(([, v]) => v.kind === 'guru')
  .map(([slug, v]) => ({ slug, ...v }))
  .sort((a, b) => a.name.localeCompare(b.name));
const updateByCik = new Map((consensus.updates || []).map((u) => [u.cik, u]));
const topStocks = [];
const seen = new Set();
for (const r of [...(consensus.mostHeld || []).slice(0, 10), ...stocks.rows]) {
  if (!r.ticker || seen.has(r.ticker)) continue;
  seen.add(r.ticker);
  topStocks.push(r);
  if (topStocks.length >= 15) break;
}

function guruLine(g, lang) {
  const h = history?.gurus?.[g.cik];
  const u = updateByCik.get(g.cik);
  if (h) {
    const q = h.quarters[h.quarters.length - 1];
    return lang === 'tr'
      ? `${q.count} pozisyon, ${fmtMoney(q.aum)}, ${q.reportDate}`
      : `${q.count} positions, ${fmtMoney(q.aum)}, as of ${q.reportDate}`;
  }
  if (u) {
    const m = biggestMove(u);
    return m ? (lang === 'tr' ? `son hamle: ${m.kind} ${m.ticker || m.issuer} (${fmtMoney(m.value)}), ${u.reportDate}` : `latest move: ${m.kind} ${m.ticker || m.issuer} (${fmtMoney(m.value)}), ${u.reportDate}`) : '';
  }
  return '';
}

function sections(lang, full) {
  const t = lang === 'tr';
  const L = [];
  // llms.txt keeps a flat H2 → link-list structure; the language is part of
  // each heading so EN and TR URLs stay in separate sections
  const H = (en, tr) => L.push(`## ${t ? tr : en} (${t ? 'TR' : 'EN'})`);
  H('Gurus', 'Usta Yatırımcılar');
  L.push(link(lang, '/gurus', t ? 'Usta yatırımcı rehberi' : 'Guru directory', t ? 'küratörlü 13F portföyleri' : 'curated 13F portfolios'));
  for (const g of gurus) L.push(link(lang, `/guru/${g.slug}`, g.name, guruLine(g, lang)));
  L.push('');
  H('Rankings', 'Sıralamalar');
  for (const k of ['most-bought', 'most-sold', 'consensus', 'conviction']) {
    const label = { 'most-bought': t ? 'En çok alınanlar' : 'Most bought', 'most-sold': t ? 'En çok satılanlar' : 'Most sold', consensus: t ? 'Konsensüs (en çok tutulan)' : 'Consensus (most owned)', conviction: t ? 'Yüksek kanaat' : 'High conviction' }[k];
    L.push(link(lang, `/rankings/${k}`, label, latestReport ? `${latestReport}` : ''));
  }
  L.push(link(lang, '/consensus', t ? 'Usta yatırımcı konsensüsü' : 'Superinvestor consensus'));
  L.push(link(lang, '/emerging-managers', t ? 'Yükselen fon yöneticileri' : 'Emerging managers'));
  L.push('');
  H('Stocks', 'Hisseler');
  for (const r of topStocks) {
    const note = r.holderCount != null ? (t ? `${r.holderCount} usta yatırımcı, ${fmtMoney(r.totalValue)}` : `${r.holderCount} superinvestors, ${fmtMoney(r.totalValue)}`) : r.funds != null ? (t ? `${r.funds} 13F dosyalayıcı, ${fmtMoney(r.value)}` : `${r.funds} 13F filers, ${fmtMoney(r.value)}`) : '';
    L.push(link(lang, `/stock/${r.ticker}`, `${r.ticker} — ${r.issuer}`, note));
  }
  L.push('');
  H('Insider', 'Insider');
  L.push(link(lang, '/insiders/cluster', t ? 'Küme alımları' : 'Cluster buys', t ? '7 gün içinde ≥2 insider, açık piyasa' : '≥2 insiders within 7 days, open market'));
  L.push(link(lang, '/insiders/csuite', t ? 'CEO / CFO alımları' : 'CEO / CFO buys'));
  L.push(link(lang, '/insiders/penny', t ? 'Kuruş hisse alımları' : 'Penny-stock buys'));
  L.push(link(lang, '/insiders', t ? 'Form 4 akışı' : 'Form 4 feed', teaser?.lastDay ? (t ? `son dosyalama günü ${teaser.lastDay}` : `latest filing day ${teaser.lastDay}`) : ''));
  L.push('');
  H('Calendar', 'Takvim');
  L.push(link(lang, '/calendar', t ? '13F bildirim takvimi' : '13F filing calendar', t ? 'son tarihler, kim bildirdi, son 7 günün bildirimleri' : 'deadlines, who has filed, filings in the last 7 days'));
  for (const id of reports.slice(0, 4)) L.push(link(lang, `/reports/${id}`, t ? `Çeyrek raporu ${id.toUpperCase()}` : `Quarterly report ${id.toUpperCase()}`));
  L.push('');
  H('Guides', 'Rehberler');
  for (const g of GUIDES) L.push(link(lang, g.paths[lang], g.title[lang], g.summary[lang]));
  for (const c of COMPARES) L.push(link(lang, c.paths[lang], c.title[lang]));
  if (full) {
    L.push('');
    H('Guru summaries', 'Usta yatırımcı özetleri');
    for (const g of gurus) {
      const text = guruAnswerFromHistory({ name: g.name, firm: null, history: history?.gurus?.[g.cik], update: updateByCik.get(g.cik) }, lang);
      if (text) L.push(`- ${g.name}: ${text}`);
    }
    if (!history) L.push(t ? '- (Çeyreklik geçmiş verisi henüz üretilmedi; özetler bir sonraki veri yenilemesinde eklenir.)' : '- (Quarterly history data has not been built yet; summaries appear with the next data refresh.)');
  }
  return L;
}

function document(full) {
  const funds = summary?.count ? summary.count.toLocaleString('en-US') : '8,000+';
  const L = [];
  L.push('# 13F Radar');
  L.push('');
  L.push(`> 13F Radar tracks the quarterly portfolios of ${funds} institutional investors from SEC Form 13F-HR filings and open-market insider trades from SEC Form 4, with curated pages for well-known superinvestors, consensus rankings and insider signals. Pages are available in English (/en) and Turkish (/tr).`);
  L.push('');
  L.push(`Data: SEC EDGAR 13F-HR (quarter-end long positions in US-listed securities, filed up to 45 days after quarter end — positions are always at least that stale and never include shorts, most derivatives or non-US holdings) and SEC Form 4 (insider transactions). Refresh cadence: insider data daily; guru/consensus/rankings daily from the latest filings; the full filer universe weekly. Last data refresh: ${updatedAt}.`);
  L.push('');
  L.push('Metric definitions: Time Held = consecutive quarters a position appears in a filer\'s 13F ending with the latest quarter (capped at ">10 Years"). Conviction = average portfolio weight of a stock among the superinvestors that hold it. Consensus = number of tracked superinvestors holding a stock. Net flow = dollar value added and newly bought minus dollar value reduced and sold out, quarter over quarter. Cluster buy = at least two distinct insiders with open-market purchases (Form 4 code P) of the same company within 7 days. Share counts are split-adjusted where a splits table exists.');
  L.push('');
  L.push('Attribution: cite pages as "13F Radar" with the page URL. Data is not investment advice.');
  L.push('');
  L.push(...sections('en', full));
  L.push('');
  L.push(...sections('tr', full));
  L.push('');
  L.push('## Optional');
  L.push(`- [Sitemap index](${site}/sitemap.xml)`);
  L.push(`- [Pricing](${site}/en/pricing): free tier covers search, top-10 positions and all pages listed above; Pro adds full tables, insider feed and exports`);
  L.push(`- [llms-full.txt](${site}/llms-full.txt)`);
  return L.join('\n') + '\n';
}

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'llms.txt'), document(false));
fs.writeFileSync(path.join(out, 'llms-full.txt'), document(true));
console.log(`llms.txt (${fs.statSync(path.join(out, 'llms.txt')).size} B) + llms-full.txt written for ${site}`);
