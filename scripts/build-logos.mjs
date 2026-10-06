// Stock logos, harvested weekly and served from this site — never a
// third-party logo service, never a request to a company's site from a
// reader's browser.
//
//   node scripts/build-logos.mjs            # top up: tickers without a logo (or older than 60 days)
//   node scripts/build-logos.mjs --refresh  # refetch everything
//
// Per ticker of the top 500 (client/public/stocks.json):
//   1. the company's website: client/public/domains.json (build-domains.mjs,
//      SEC-sourced), else Finnhub's profile when FINNHUB_API_KEY is set
//      (paced at LOGO_FINNHUB_PER_MIN, half the shared 50/min job budget)
//   2. that site's robots.txt is read and obeyed (FundocapBot / *)
//   3. its home page's <link rel="apple-touch-icon">, <link rel="icon"
//      sizes≥64> or a near-square og:image — never favicon.ico — validated
//      by magic bytes and pixel size (shorter side ≥ 64px), ≤ 150 KB
//   4. when the site itself yields nothing (bot walls, CDN challenges, no
//      declared icon): the public favicon caches — DuckDuckGo, then Google
//      at 128px — fetched HERE, once, and committed like any other logo.
//      The same size rule applies, so their "unknown site" placeholder
//      (16px) never passes. LOGO_FALLBACK=0 turns this step off.
// Output: client/public/logos/{TICKER}.{ext} + client/public/logos.json
// (tried, ok, pct, bytes, per-source counts). Below 10% success the
// manifest ships empty (`disabled: true`) and every page keeps the badge.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { parseRobots, robotsAllows, imageInfo, usable, MIN_SIDE } from '../api/_lib/logoScrape.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'client', 'public');
const outDir = path.join(pub, 'logos');
const manifestPath = path.join(pub, 'logos.json');
const domainsPath = path.join(pub, 'domains.json');
const refresh = process.argv.includes('--refresh');

const TOP = Number(process.env.LOGOS_TOP) || 500;
// Below this the set is too patchy to be worth shipping; above it, a logo
// where we have one and the badge elsewhere reads fine side by side.
const MIN_PCT = 10;
const MAX_BYTES = 150 * 1024;
const STALE_DAYS = 60;
const PER_MIN = Number(process.env.LOGO_FINNHUB_PER_MIN) || 25;
const FALLBACK = process.env.LOGO_FALLBACK !== '0';
const UA = 'FundocapBot/1.0 (+https://www.fundocap.co; hello@fundocap.co)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const http = axios.create({
  timeout: 12000,
  maxRedirects: 4,
  maxContentLength: 600 * 1024,
  responseType: 'arraybuffer',
  headers: { 'User-Agent': UA, Accept: 'text/html,image/*;q=0.9,*/*;q=0.5' },
  validateStatus: (s) => s >= 200 && s < 300,
});
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// ---------- robots.txt: one group per host, cached ----------
const robotsCache = new Map();
async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let rules = { allow: [], disallow: [] };
  try {
    const r = await http.get(`${origin}/robots.txt`, { responseType: 'text', transformResponse: [(d) => d], timeout: 8000 });
    rules = parseRobots(r.data);
  } catch { /* no robots.txt: everything allowed */ }
  robotsCache.set(origin, rules);
  return rules;
}
async function allowed(urlStr) {
  const u = new URL(urlStr);
  return robotsAllows(await robotsFor(u.origin), u.pathname);
}

async function fetchImage(urlStr, opts) {
  if (!(await allowed(urlStr))) return null;
  const r = await http.get(urlStr);
  const buf = Buffer.from(r.data);
  if (buf.length > MAX_BYTES) return null;
  const info = imageInfo(buf);
  return usable(info, opts) ? { buf, ext: info.ext } : null;
}

// ---------- the site's declared icons, in order of preference ----------
async function logoFor(site) {
  let origin;
  try { origin = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).origin; } catch { return null; }
  if (!(await allowed(`${origin}/`))) return null;
  const r = await http.get(`${origin}/`, { responseType: 'text', transformResponse: [(d) => d] });
  const html = String(r.data).slice(0, 400 * 1024);
  const finalOrigin = (() => { try { return new URL(r.request?.res?.responseUrl || origin).origin; } catch { return origin; } })();
  const tags = [...html.matchAll(/<(link|meta)\s[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']?([^"'\\s>]+)`, 'i'))?.[1];
  const sizeOf = (tag) => Math.max(0, ...(attr(tag, 'sizes') || '').split(/\s+/).map((s) => Number(s.split('x')[0]) || 0));
  const abs = (href) => { try { return new URL(href, finalOrigin).href; } catch { return null; } };
  const links = tags.filter((t) => /^<link/i.test(t)).map((t) => ({ rel: (attr(t, 'rel') || '').toLowerCase(), href: attr(t, 'href'), size: sizeOf(t) })).filter((l) => l.href && !l.href.startsWith('data:'));
  const candidates = [
    ...links.filter((l) => l.rel.includes('apple-touch-icon')).sort((a, b) => b.size - a.size).map((l) => ({ url: abs(l.href), src: 'apple' })),
    { url: `${finalOrigin}/apple-touch-icon.png`, src: 'apple' },
    ...links.filter((l) => /(^|\s)icon(\s|$)/.test(l.rel) && !/\.ico(\?|$)/i.test(l.href)).sort((a, b) => b.size - a.size).map((l) => ({ url: abs(l.href), src: 'icon' })),
    ...tags.filter((t) => /^<meta/i.test(t) && /(property|name)\s*=\s*["']?(og:image|twitter:image)/i.test(t)).map((t) => ({ url: abs(attr(t, 'content')), src: 'og', square: true })),
  ].filter((c) => c.url);
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.url)) continue; seen.add(c.url);
    try { const img = await fetchImage(c.url, { square: c.square }); if (img) return { ...img, src: c.src }; } catch { /* next */ }
  }
  return null;
}

// ---------- the favicon caches, by host, when the site gave nothing ----------
// Their robots.txt is not consulted: these are APIs meant to be called, and
// the image is the site's own icon, not the cache's content.
const fallbackUrls = (host) => [
  { url: `https://icons.duckduckgo.com/ip3/${host}.ico`, src: 'ddg' },
  { url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`, src: 'google' },
];
async function fallbackFor(site) {
  let host;
  try { host = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).hostname.replace(/^www\./, ''); } catch { return null; }
  if (!host) return null;
  for (const c of fallbackUrls(host)) {
    try {
      const r = await http.get(c.url);
      const buf = Buffer.from(r.data);
      if (buf.length > MAX_BYTES) continue;
      const info = imageInfo(buf);
      if (usable(info)) return { buf, ext: info.ext, src: c.src };
    } catch { /* next */ }
  }
  return null;
}

// ---------- Finnhub profile → website, paced ----------
async function websiteOf(sym, key) {
  const r = await axios.get('https://finnhub.io/api/v1/stock/profile2', { params: { symbol: sym, token: key }, timeout: 15000, validateStatus: () => true });
  if (r.status === 429) { await sleep(60000); return websiteOf(sym, key); }
  if (r.status !== 200) return null;
  return String(r.data?.weburl || '').trim() || null;
}

async function main() {
  const key = process.env.FINNHUB_API_KEY || '';
  const domains = readJson(domainsPath)?.domains || {};
  if (!key && !Object.keys(domains).length) { console.log('::warning::logos: neither domains.json nor FINNHUB_API_KEY — nothing fetched'); return; }
  const stocks = readJson(path.join(pub, 'stocks.json'));
  const tickers = [...new Set((stocks?.rows || []).map((s) => String(s.ticker || '').trim().toUpperCase()).filter(Boolean))].slice(0, TOP);
  if (!tickers.length) { console.log('::warning::logos: stocks.json has no tickers'); return; }
  fs.mkdirSync(outDir, { recursive: true });
  const prior = readJson(manifestPath);
  const fetched = { ...(prior?.fetched || {}) };
  const logos = {};
  const sources = {};
  const fresh = (sym) => { const at = fetched[sym]; return at && (Date.now() - Date.parse(at)) / 86400000 < STALE_DAYS; };
  let kept = 0, got = 0, noSite = 0, noIcon = 0;

  for (const [i, t] of tickers.entries()) {
    const key2 = t.replace(/\./g, '-');
    const existing = prior?.logos?.[key2];
    if (!refresh && existing && fs.existsSync(path.join(pub, existing)) && fresh(key2)) { logos[key2] = existing; kept++; continue; }
    const t0 = Date.now();
    const site = domains[t] || domains[key2] || (key ? await websiteOf(t, key).catch(() => null) : null);
    if (!site) { noSite++; }
    else {
      const img = (await logoFor(site).catch(() => null)) || (FALLBACK ? await fallbackFor(site) : null);
      if (!img) noIcon++;
      else {
        const file = `logos/${key2.replace(/[^A-Z0-9-]/g, '')}.${img.ext}`;
        fs.writeFileSync(path.join(pub, file), img.buf);
        logos[key2] = file; fetched[key2] = new Date().toISOString(); sources[img.src] = (sources[img.src] || 0) + 1; got++;
      }
    }
    if ((i + 1) % 50 === 0) console.log(`logos: ${i + 1}/${tickers.length} · ${got} new, ${kept} kept, ${noSite} no site, ${noIcon} no icon`);
    await sleep(Math.max(0, Math.ceil(60000 / PER_MIN) - (Date.now() - t0)));
  }

  const ok = Object.keys(logos).length;
  const pct = Math.round((ok / tickers.length) * 100);
  const bytes = Object.values(logos).reduce((s, f) => { try { return s + fs.statSync(path.join(pub, f)).size; } catch { return s; } }, 0);
  const keep = new Set(Object.values(logos).map((f) => path.basename(f)));
  for (const f of fs.readdirSync(outDir)) if (!keep.has(f)) fs.rmSync(path.join(outDir, f));
  const base = { updatedAt: new Date().toISOString(), tried: tickers.length, ok, pct, bytes, sources, noSite, noIcon, fetched };
  if (pct < MIN_PCT) {
    for (const f of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, f));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...base, disabled: true, logos: {} }));
    console.log(`::warning::logos: ${ok}/${tickers.length} (${pct}%) — below ${MIN_PCT}%, logos disabled, badges stay. ${noSite} without a website, ${noIcon} without a usable icon`);
    return;
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ ...base, logos }));
  console.log(`logos: ${ok}/${tickers.length} (${pct}%), ${(bytes / 1024).toFixed(0)} KB on disk · sources ${JSON.stringify(sources)} · ${noSite} without a website, ${noIcon} without a usable icon`);
}

await main();
