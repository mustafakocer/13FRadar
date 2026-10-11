// Stock logos harvested into this repo and served from this site — the
// fallback behind the logo CDN (TickerLogo.jsx) for brands it does not know,
// and the whole logo when no CDN client id is set. Never a request to a
// company's site from a reader's browser.
//
//   node scripts/build-logos.mjs            # top up: the next LOGOS_BATCH tickers without a logo (or older than 60 days)
//   node scripts/build-logos.mjs --refresh  # refetch everything
//
// First, Brandfetch — the brand's own icon, by domain — for every ticker
// without a logo or with only a favicon-size .ico, at most BRANDFETCH_BATCH
// (default 2000) per run, each ticker asked again after STALE_DAYS:
//   a. the Brand API (BRANDFETCH_API_KEY): the brand's icon / symbol / logo
//      files (brandfetchCandidates), raster only, ≥ 64px
//   b. else the Logo Link CDN (BRANDFETCH_CLIENT_ID, the same id as the
//      site's VITE_BRANDFETCH_CLIENT_ID), told to answer 404 for an unknown
//      brand so its lettermark never lands here
// A 401/403 or a second 429 turns that source off for the rest of the run.
//
// Then, per ticker of client/public/domains.json, in its order (most visible
// first; build-domains.mjs), at most LOGOS_BATCH (default 400) per run so a
// daily run walks the whole set in about two weeks and then only tops up:
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
// (ok, bytes, per-source counts, `fetched`, `missed` and `bf` (Brandfetch
// asked) timestamps, `src` per ticker). A ticker whose site gave no usable
// icon is not asked again for STALE_DAYS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { parseRobots, robotsAllows, imageInfo, usable, brandfetchCandidates } from '../api/_lib/logoScrape.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'client', 'public');
const outDir = path.join(pub, 'logos');
const manifestPath = path.join(pub, 'logos.json');
const domainsPath = path.join(pub, 'domains.json');
const refresh = process.argv.includes('--refresh');

const BATCH = Number(process.env.LOGOS_BATCH) || 400;
const MAX_BYTES = 150 * 1024;
const STALE_DAYS = 60;
const PER_MIN = Number(process.env.LOGO_FINNHUB_PER_MIN) || 25;
const FALLBACK = process.env.LOGO_FALLBACK !== '0';
const BF_KEY = (process.env.BRANDFETCH_API_KEY || '').trim();
const BF_ID = (process.env.BRANDFETCH_CLIENT_ID || '').trim();
const BF_BATCH = Number(process.env.BRANDFETCH_BATCH) || 2000;
const BF_DELAY = Number(process.env.BRANDFETCH_DELAY_MS) || 150;
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

// ---------- Brandfetch, by domain ----------
// Not robots-gated: an API and a CDN made to be called. Returns the image,
// null for "no such brand / nothing usable", or throws BfOff when the source
// refuses us (bad key, plan exhausted) so the run stops asking it.
class BfOff extends Error {}
const bfOff = { api: !BF_KEY, cdn: !BF_ID };
const bfHttp = axios.create({ timeout: 15000, maxRedirects: 3, maxContentLength: 600 * 1024, responseType: 'arraybuffer', headers: { 'User-Agent': UA }, validateStatus: () => true });
async function bfGet(url, opts, retried = false) {
  const r = await bfHttp.get(url, opts);
  if (r.status === 429 && !retried) { await sleep(60000); return bfGet(url, opts, true); }
  if (r.status === 401 || r.status === 403 || r.status === 429) throw new BfOff(`HTTP ${r.status}`);
  // the Logo Link CDN answers a non-browser caller with a 302 to its
  // hotlinking guidelines: it serves readers' browsers only
  if (r.status >= 300 && r.status < 400) throw new BfOff(`HTTP ${r.status} → ${r.headers?.location || 'redirect'}`);
  return r;
}
const bfImage = (r) => {
  if (r.status !== 200) return null;
  const buf = Buffer.from(r.data);
  if (buf.length > MAX_BYTES) return null;
  const info = imageInfo(buf);
  return info && info.ext !== 'svg' && usable(info) ? { buf, ext: info.ext } : null;
};
async function brandfetchApi(domain) {
  const r = await bfGet(`https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`, { responseType: 'json', headers: { Authorization: `Bearer ${BF_KEY}`, Accept: 'application/json' } });
  if (r.status !== 200) return null;
  let brand = r.data;
  if (Buffer.isBuffer(brand) || brand instanceof ArrayBuffer) { try { brand = JSON.parse(Buffer.from(brand).toString('utf8')); } catch { return null; } }
  for (const url of brandfetchCandidates(brand).slice(0, 4)) {
    try { const img = bfImage(await bfHttp.get(url)); if (img) return img; } catch { /* next */ }
  }
  return null;
}
async function brandfetchCdn(domain) {
  return bfImage(await bfGet(`https://cdn.brandfetch.io/${encodeURIComponent(domain)}/w/256/h/256/fallback/404?c=${encodeURIComponent(BF_ID)}`, { maxRedirects: 0 }));
}
async function brandfetchFor(domain) {
  for (const [name, fn] of [['api', brandfetchApi], ['cdn', brandfetchCdn]]) {
    if (bfOff[name]) continue;
    try { const img = await fn(domain); if (img) return { ...img, src: `brandfetch-${name}` }; }
    catch (e) {
      if (e instanceof BfOff) { bfOff[name] = true; console.log(`::warning::logos: Brandfetch ${name} refused (${e.message}) — off for this run`); }
      // a network error on one brand is that brand's miss, not the source's
    }
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
  const tickers = Object.keys(domains).filter((t) => /^[A-Z][A-Z0-9.-]{0,6}$/.test(t));
  if (!tickers.length) { console.log('::warning::logos: domains.json has no tickers — run build-domains.mjs first'); return; }
  fs.mkdirSync(outDir, { recursive: true });
  const prior = refresh ? null : readJson(manifestPath);
  const fetched = { ...(prior?.fetched || {}) };
  const missed = { ...(prior?.missed || {}) };
  const bf = { ...(prior?.bf || {}) };
  const src = { ...(prior?.src || {}) };
  // last run's set, minus files that have gone missing
  const logos = Object.fromEntries(Object.entries(prior?.logos || {}).filter(([, f]) => fs.existsSync(path.join(pub, f))));
  const sources = {};
  const fresh = (at) => at && (Date.now() - Date.parse(at)) / 86400000 < STALE_DAYS;
  const save = (k, img) => {
    const file = `logos/${k.replace(/[^A-Z0-9-]/g, '')}.${img.ext}`;
    fs.writeFileSync(path.join(pub, file), img.buf);
    logos[k] = file; fetched[k] = new Date().toISOString(); delete missed[k]; src[k] = img.src; sources[img.src] = (sources[img.src] || 0) + 1;
  };

  // Brandfetch first: no logo yet, or only a favicon-size .ico
  const bfWants = (t, k) => domains[t] && !fresh(bf[k]) && (!logos[k] || /\.ico$/i.test(logos[k]));
  let bfGot = 0, bfTried = 0;
  if (!bfOff.api || !bfOff.cdn) {
    const bfTodo = tickers.map((t) => [t, t.replace(/\./g, '-')]).filter(([t, k]) => bfWants(t, k)).slice(0, BF_BATCH);
    for (const [i, [t, k]] of bfTodo.entries()) {
      if (bfOff.api && bfOff.cdn) break;
      const img = await brandfetchFor(domains[t]);
      if (bfOff.api && bfOff.cdn && !img) break; // refused mid-ticker: not a real miss
      bf[k] = new Date().toISOString(); bfTried++;
      if (img) { save(k, img); bfGot++; }
      if ((i + 1) % 100 === 0) console.log(`logos: Brandfetch ${i + 1}/${bfTodo.length} · ${bfGot} new`);
      await sleep(BF_DELAY);
    }
    console.log(`logos: Brandfetch asked ${bfTried}, ${bfGot} new`);
  } else console.log('logos: Brandfetch off (no BRANDFETCH_API_KEY / BRANDFETCH_CLIENT_ID)');

  const todo = tickers.map((t) => [t, t.replace(/\./g, '-')]).filter(([, k]) => !(logos[k] && fresh(fetched[k])) && !fresh(missed[k])).slice(0, BATCH);
  let got = 0, noSite = 0, noIcon = 0;

  for (const [i, [t, key2]] of todo.entries()) {
    const t0 = Date.now();
    const site = domains[t] || domains[key2] || (key ? await websiteOf(t, key).catch(() => null) : null);
    if (!site) { noSite++; missed[key2] = new Date().toISOString(); }
    else {
      const img = (await logoFor(site).catch(() => null)) || (FALLBACK ? await fallbackFor(site) : null);
      if (!img) { noIcon++; missed[key2] = new Date().toISOString(); }
      else { save(key2, img); got++; }
    }
    if ((i + 1) % 50 === 0) console.log(`logos: ${i + 1}/${todo.length} · ${got} new, ${noSite} no site, ${noIcon} no icon`);
    await sleep(Math.max(0, Math.ceil(60000 / PER_MIN) - (Date.now() - t0)));
  }

  const ok = Object.keys(logos).length;
  const bytes = Object.values(logos).reduce((s, f) => { try { return s + fs.statSync(path.join(pub, f)).size; } catch { return s; } }, 0);
  const keep = new Set(Object.values(logos).map((f) => path.basename(f)));
  for (const f of fs.readdirSync(outDir)) if (!keep.has(f)) fs.rmSync(path.join(outDir, f));
  for (const k of Object.keys(src)) if (!logos[k]) delete src[k];
  const bfLeft = BF_KEY || BF_ID ? tickers.filter((t) => bfWants(t, t.replace(/\./g, '-'))).length : 0;
  const left = tickers.filter((t) => { const k = t.replace(/\./g, '-'); return !(logos[k] && fresh(fetched[k])) && !fresh(missed[k]); }).length;
  fs.writeFileSync(manifestPath, JSON.stringify({ updatedAt: new Date().toISOString(), universe: tickers.length, ok, pct: Math.round((ok / tickers.length) * 100), bytes, backlog: left, bfBacklog: bfLeft, sources, fetched, missed, bf, src, logos }));
  console.log(`logos: ${ok}/${tickers.length} (${Math.round((ok / tickers.length) * 100)}%), ${(bytes / 1024).toFixed(0)} KB on disk · Brandfetch ${bfGot}/${bfTried} (${bfLeft} still to ask) · this run ${todo.length}: ${got} new (${JSON.stringify(sources)}), ${noSite} without a website, ${noIcon} without a usable icon · ${left} still to try`);
}

await main();
