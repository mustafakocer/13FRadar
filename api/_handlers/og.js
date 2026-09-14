import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { invoke, withBudget } from '../_lib/ssr/invoke.js';
import manager from './manager.js';
import holdings from './holdings.js';
import stock from './stock.js';
import { createRequire } from 'node:module';
import fsSync from 'node:fs';

// GET /api/og                         → default brand card
// GET /api/og?type=guru&cik=…         → name, portfolio value, top 3 holdings, quarter
// GET /api/og?type=stock&ticker=…     → company, price, number of 13F holders
// 1200×630 PNG composed as SVG and rasterised with resvg (DejaVu Sans, vendored).
const here = path.dirname(fileURLToPath(import.meta.url));
const FONTS = [path.join(here, '..', '_assets', 'DejaVuSans.ttf'), path.join(here, '..', '_assets', 'DejaVuSans-Bold.ttf')];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const money = (v) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(0)}M`;
  return `$${a.toFixed(0)}`;
};
const quarter = (d) => (d ? `Q${Math.ceil(Number(d.slice(5, 7)) / 3)} ${d.slice(0, 4)}` : '');

function card({ kicker, title, sub, stats = [], rows = [] }) {
  const statSvg = stats
    .map(([label, value], i) => {
      const x = 80 + i * 300;
      return `<text x="${x}" y="420" font-size="44" font-weight="bold" fill="#ffd250">${esc(value)}</text><text x="${x}" y="456" font-size="20" fill="#c3cbdd">${esc(label)}</text>`;
    })
    .join('');
  const rowSvg = rows
    .map(([a, b], i) => {
      const y = 520 + i * 34;
      return `<text x="80" y="${y}" font-size="24" font-weight="bold" fill="#ffffff">${esc(a)}</text><text x="380" y="${y}" font-size="22" fill="#c3cbdd">${esc(b)}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" font-family="DejaVu Sans">
  <defs><radialGradient id="g" cx="85%" cy="15%" r="70%"><stop offset="0" stop-color="#12264f"/><stop offset="1" stop-color="#0d1b3e"/></radialGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect x="0" y="0" width="1200" height="8" fill="#ffd250"/>
  <g transform="translate(80,62) scale(1.5)"><rect x="3.9" y="3.3" width="3.4" height="17.4" rx="1.7" fill="#ffffff"/><rect x="8.9" y="3.3" width="11.2" height="3.4" rx="1.7" fill="#ffd250"/><rect x="8.9" y="9.8" width="7.1" height="3.4" rx="1.7" fill="#ffffff"/></g><text x="126" y="90" font-size="30" font-weight="bold" fill="#ffffff">Fundo<tspan fill="#ffd250">cap</tspan></text>
  <text x="80" y="160" font-size="22" fill="#ffd250" letter-spacing="3">${esc(kicker)}</text>
  <text x="80" y="235" font-size="${title.length > 34 ? 44 : 56}" font-weight="bold" fill="#ffffff">${esc(clip(title, 46))}</text>
  <text x="80" y="290" font-size="26" fill="#c3cbdd">${esc(clip(sub, 80))}</text>
  ${statSvg}${rowSvg}
  <text x="1120" y="600" font-size="18" fill="#8f9bb5" text-anchor="end">Source: SEC EDGAR · not investment advice</text>
</svg>`;
}

async function guruCard(cik) {
  const m = await withBudget(invoke(manager, { cik }), 8000);
  if (!m || m.status !== 200) return null;
  const f = m.body.filings?.[0];
  let h = null;
  if (f) {
    const r = await withBudget(invoke(holdings, { cik, acc: f.acc }), 8000);
    if (r?.status === 200) h = r.body;
  }
  const top = (h?.positions || []).slice(0, 3).map((p) => [p.ticker || clip(p.issuer, 14), `${p.weight.toFixed(1)}% · ${money(p.value)}`]);
  return card({
    kicker: `13F PORTFOLIO · ${quarter(f?.reportDate)}`,
    title: m.body.displayName || m.body.name,
    sub: `CIK ${m.body.cik}${f ? ` · filed ${f.filingDate}` : ''}`,
    stats: [
      ['Portfolio value', money(h?.aum)],
      ['Positions', h?.count != null ? String(h.count) : '—'],
      ['Top 10 weight', h ? `${(h.positions || []).slice(0, 10).reduce((s, p) => s + p.weight, 0).toFixed(0)}%` : '—'],
    ],
    rows: top,
  });
}

// The superinvestors that actually hold the stock, from the same consensus
// file the page renders — not a count of EDGAR full-text search hits.
const ogRequire = createRequire(import.meta.url);
function consensusRowFor(ticker) {
  try {
    const c = ogRequire('../../client/public/consensus.json');
    return (c?.mostHeld || []).find((r) => r.ticker === ticker) || null;
  } catch {
    return null;
  }
}

async function stockCard(ticker) {
  const s = await withBudget(invoke(stock, { ticker }), 8000);
  if (!s || s.status !== 200) return null;
  const p = s.body.price || {};
  const row = consensusRowFor((p.symbol || ticker || '').toUpperCase());
  const top = (row?.holders || [])
    .slice(0, 3)
    .map((x) => [clip(x.name, 28), x.weight != null ? `${x.weight.toFixed(1)}% of portfolio` : '']);
  return card({
    kicker: 'WHO OWNS IT · FORM 13F',
    title: `${p.symbol || ticker} · ${p.name || ''}`,
    sub: p.price != null ? `${p.price.toFixed(2)} ${p.currency || 'USD'}${p.changePercent != null ? ` (${p.changePercent >= 0 ? '+' : ''}${p.changePercent.toFixed(2)}%)` : ''}` : '',
    stats: [
      ['Superinvestors', row?.holderCount != null ? String(row.holderCount) : '—'],
      ['Market cap', money(p.marketCap)],
      ['P/E', s.body.valuation?.trailingPE != null ? s.body.valuation.trailingPE.toFixed(1) : '—'],
    ],
    rows: top,
  });
}

// Report chart pack: horizontal bar chart of the top entries.
function barChart({ title, sub, rows, color, valueOf, labelOf }) {
  const max = Math.max(...rows.map((r) => Math.abs(valueOf(r))), 1);
  const bars = rows
    .slice(0, 10)
    .map((r, i) => {
      const y = 190 + i * 40;
      const w = Math.max(4, (Math.abs(valueOf(r)) / max) * 620);
      return `<text x="80" y="${y + 20}" font-size="22" font-weight="bold" fill="#ffffff">${esc(clip(labelOf(r), 14))}</text>
  <rect x="320" y="${y}" width="${w.toFixed(0)}" height="26" rx="6" fill="${color}"/>
  <text x="${(320 + w + 12).toFixed(0)}" y="${y + 20}" font-size="20" fill="#c3cbdd">${esc(money(Math.abs(valueOf(r))))}</text>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" font-family="DejaVu Sans">
  <rect width="1200" height="630" fill="#0d1b3e"/><rect x="0" y="0" width="1200" height="8" fill="#ffd250"/>
  <g transform="translate(80,52) scale(1.5)"><rect x="3.9" y="3.3" width="3.4" height="17.4" rx="1.7" fill="#ffffff"/><rect x="8.9" y="3.3" width="11.2" height="3.4" rx="1.7" fill="#ffd250"/><rect x="8.9" y="9.8" width="7.1" height="3.4" rx="1.7" fill="#ffffff"/></g><text x="126" y="80" font-size="30" font-weight="bold" fill="#ffffff">Fundo<tspan fill="#ffd250">cap</tspan></text>
  <text x="80" y="128" font-size="38" font-weight="bold" fill="#ffffff">${esc(clip(title, 50))}</text>
  <text x="80" y="160" font-size="22" fill="#c3cbdd">${esc(clip(sub, 90))}</text>
  ${bars}
  <text x="1120" y="608" font-size="18" fill="#8f9bb5" text-anchor="end">Source: SEC EDGAR 13F-HR · not investment advice</text>
</svg>`;
}

function reportCard(id, chart) {
  const file = path.join(process.cwd(), 'api', '_data', 'reports', `${id}.json`);
  if (!/^\d{4}-q[1-4]$/.test(id) || !fsSync.existsSync(file)) return null;
  const r = JSON.parse(fsSync.readFileSync(file, 'utf8'));
  const q = `Q${r.quarter} ${r.year}`;
  const sub = `${r.coverage.onQuarter} tracked superinvestors · 13F filings for ${r.quarterEnd}`;
  const sym = (x) => x.ticker || clip(x.issuer, 12);
  if (chart === 'sells') return barChart({ title: `${q} · Top net sells`, sub, rows: r.topSellsByValue, color: '#f2645f', valueOf: (x) => x.netValue, labelOf: sym });
  if (chart === 'moves') return barChart({ title: `${q} · Notable moves (% change)`, sub, rows: r.notableMoves, color: '#7ea0ff', valueOf: (x) => x.change, labelOf: (x) => `${sym(x)} ${x.change > 0 ? '+' : ''}${x.change.toFixed(0)}%` });
  return barChart({ title: `${q} · Top net buys`, sub, rows: r.topBuysByValue, color: '#2fbf8f', valueOf: (x) => x.netValue, labelOf: sym });
}

const defaultCard = () =>
  card({
    kicker: 'SEC 13F · FORM 4 · 13D/G',
    title: 'Track the Smart Money & Insiders',
    sub: "Real money flows of Wall Street's top funds and corporate insiders",
    stats: [
      ['Investment funds', '7,800+'],
      ['Assets tracked', '$60T+'],
      ['Data', 'SEC EDGAR'],
    ],
  });

export default async function handler(req, res) {
  const type = String(req.query.type || '');
  let svg = null;
  try {
    if (type === 'guru' && /^\d{1,10}$/.test(String(req.query.cik || ''))) svg = await guruCard(String(req.query.cik).padStart(10, '0'));
    else if (type === 'stock' && /^[A-Za-z0-9.\-]{1,12}$/.test(String(req.query.ticker || ''))) svg = await stockCard(String(req.query.ticker).toUpperCase());
    else if (type === 'report') svg = reportCard(String(req.query.id || '').toLowerCase(), String(req.query.chart || 'buys'));
  } catch (e) {
    console.error('og card failed', e?.message || e);
  }
  if (!svg) svg = defaultCard();
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontFiles: FONTS.filter((f) => fs.existsSync(f)), loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
  })
    .render()
    .asPng();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  res.status(200).send(Buffer.from(png));
}
