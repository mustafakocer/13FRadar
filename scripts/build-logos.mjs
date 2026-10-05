// Stock logos for the client, fetched overnight and served from this site —
// never from a third-party logo service at page-view time.
//
//   node scripts/build-logos.mjs            # top up: only tickers without a logo
//   node scripts/build-logos.mjs --refresh  # refetch everything
//
// Pipeline, per ticker of the top 500 (client/public/stocks.json):
//   1. SEC company_tickers.json → CIK
//   2. SEC submissions JSON → the company's own website (no website: no logo)
//   3. that site's /favicon.ico, else the first <link rel="icon"> on its
//      home page — validated by magic bytes, capped in size
// Output: client/public/logos/{TICKER}.{ext} + client/public/logos.json.
//
// The kill switch the client honours: when fewer than 30% of the tried
// tickers produced a logo, the manifest ships empty (`disabled: true`) and
// every page falls back to the two-letter badge.
//
// Env: SEC_USER_AGENT (required for SEC requests).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { secGet } from '../api/_lib/sec.js';
import { mapLimit } from '../api/_lib/mapLimit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'client', 'public');
const outDir = path.join(pub, 'logos');
const manifestPath = path.join(pub, 'logos.json');
const refresh = process.argv.includes('--refresh');

const TOP = Number(process.env.LOGOS_TOP) || 500;
const MIN_PCT = 30; // below this success rate the feature turns itself off
const MAX_BYTES = 120 * 1024;
const http = axios.create({
  timeout: 10000,
  maxRedirects: 4,
  maxContentLength: 512 * 1024,
  responseType: 'arraybuffer',
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FundocapBot/1.0; +https://www.fundocap.co)' },
  validateStatus: (s) => s >= 200 && s < 300,
});

const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

// what the bytes say the file is — the server's content-type lies often enough
function sniff(buf) {
  if (!buf || buf.length < 8) return null;
  const b = Buffer.from(buf);
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'ico';
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  const head = b.toString('utf8', 0, Math.min(b.length, 512)).trimStart().toLowerCase();
  if (head.startsWith('<') && head.includes('<svg')) return 'svg';
  return null;
}

async function fetchIcon(urlStr) {
  const r = await http.get(urlStr);
  const buf = Buffer.from(r.data);
  if (buf.length > MAX_BYTES) return null;
  const ext = sniff(buf);
  return ext ? { buf, ext } : null;
}

// the home page's declared icon, when /favicon.ico is not there
async function iconFromHomepage(origin) {
  const r = await http.get(origin, { responseType: 'text', transformResponse: [(d) => d] });
  const html = String(r.data).slice(0, 300 * 1024);
  const links = [...html.matchAll(/<link\s[^>]*rel=["']?([^"'>]*icon[^"'>]*)["']?[^>]*>/gi)].map((m) => m[0]);
  for (const tag of links) {
    const href = tag.match(/href=["']?([^"'\s>]+)/i)?.[1];
    if (!href || href.startsWith('data:')) continue;
    try {
      const icon = await fetchIcon(new URL(href, origin).href);
      if (icon) return icon;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

async function logoFor(site) {
  let origin;
  try {
    origin = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).origin;
  } catch {
    return null;
  }
  try {
    const direct = await fetchIcon(`${origin}/favicon.ico`);
    if (direct) return direct;
  } catch {
    /* fall through to the home page */
  }
  try {
    return await iconFromHomepage(origin);
  } catch {
    return null;
  }
}

async function main() {
  const stocks = readJson(path.join(pub, 'stocks.json'));
  const tickers = [...new Set((Array.isArray(stocks) ? stocks : stocks?.rows || stocks?.stocks || [])
    .map((s) => String(s.ticker || '').trim().toUpperCase())
    .filter(Boolean))].slice(0, TOP);
  if (!tickers.length) {
    console.log('::warning::logos: stocks.json has no tickers — nothing to do');
    return;
  }

  // ticker → CIK, in SEC's hyphen spelling (BRK-B)
  const { data: ct } = await secGet('https://www.sec.gov/files/company_tickers.json', { timeout: 30000 });
  const cikOf = {};
  for (const row of Object.values(ct || {})) {
    const t = String(row?.ticker || '').trim().toUpperCase();
    if (t && row?.cik_str && !cikOf[t]) cikOf[t] = String(row.cik_str).padStart(10, '0');
  }
  const cikFor = (t) => cikOf[t] || cikOf[t.replace(/\./g, '-')] || cikOf[t.replace(/-/g, '.')] || null;

  fs.mkdirSync(outDir, { recursive: true });
  const prior = readJson(manifestPath);
  const logos = {};
  let okCount = 0;

  // SEC submissions carry the registrant's own website; fetched politely
  // through secGet (its own EDGAR rate clock).
  const sites = new Map();
  await mapLimit(tickers, 3, async (t) => {
    const cik = cikFor(t);
    if (!cik) return;
    try {
      const { data } = await secGet(`https://data.sec.gov/submissions/CIK${cik}.json`, { timeout: 20000 });
      const site = String(data?.website || data?.investorWebsite || '').trim();
      if (site) sites.set(t, site);
    } catch {
      /* no submissions answer: no logo for this one */
    }
  });

  await mapLimit(tickers, 6, async (t) => {
    const key = t.replace(/\./g, '-');
    const existing = prior?.logos?.[key];
    if (!refresh && existing && fs.existsSync(path.join(pub, existing))) {
      logos[key] = existing;
      okCount++;
      return;
    }
    const site = sites.get(t);
    if (!site) return;
    const icon = await logoFor(site);
    if (!icon) return;
    const file = `logos/${key.replace(/[^A-Z0-9-]/g, '')}.${icon.ext}`;
    fs.writeFileSync(path.join(pub, file), icon.buf);
    logos[key] = file;
    okCount++;
  });

  const tried = tickers.length;
  const pct = Math.round((okCount / tried) * 100);
  const disabled = pct < MIN_PCT;
  if (disabled) {
    // badge-only mode: nothing referenced, nothing served
    for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f));
    fs.writeFileSync(manifestPath, JSON.stringify({ updatedAt: new Date().toISOString(), tried, ok: okCount, pct, disabled: true, logos: {} }));
    console.log(`::warning::logos: ${okCount}/${tried} (${pct}%) — below ${MIN_PCT}%, logos disabled, badges stay`);
    return;
  }
  // drop files no longer in the manifest, so the folder mirrors it
  const keep = new Set(Object.values(logos).map((f) => path.basename(f)));
  for (const f of fs.readdirSync(outDir)) if (!keep.has(f)) fs.rmSync(path.join(outDir, f));
  fs.writeFileSync(manifestPath, JSON.stringify({ updatedAt: new Date().toISOString(), tried, ok: okCount, pct, logos }));
  console.log(`logos: ${okCount}/${tried} tickers (${pct}%) → client/public/logos`);
}

await main();
