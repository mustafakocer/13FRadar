// The security master: one table from a 13F identifier (CUSIP, or the CINS a
// non-US issuer carries) to the security — ticker, name, exchange, FIGI, the
// window the mapping is valid for, and where it came from.
//
//   api/_data/security-master.json
//   {
//     updatedAt,
//     byCusip:    { [cusip]: { ticker, name, exchange, figi, validFrom, validTo, source, resolvedAt } },
//     unresolved: { [cusip]: { name, attempts, lastTried, lastError } }
//   }
//
// Every CUSIP → ticker lookup on the site goes through here: the holdings
// endpoints, the consensus and history builds, the universe build, the
// read-time resolution the history endpoint does for stored raw CUSIPs.
// OpenFIGI (figi.js) is consulted only at ingest — by the builds, which have
// a key and no deadline — and its answer is written back here, so a request
// never waits on it and a CUSIP is never looked up twice. An identifier
// OpenFIGI could not map is recorded too, with when it was tried, and
// retried by the daily build after RETRY_AFTER; until then the UI shows the
// issuer name the filing itself carries, never the raw code.
//
// The old flat map (api/_data/cusip-tickers.json) is kept as a derived view
// for readers that only need { cusip: ticker }; persist() rewrites it.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '_data');
const MASTER_FILE = () => process.env.SECURITY_MASTER_FILE || path.join(root, 'security-master.json');
const FLAT_FILE = () => path.join(root, 'cusip-tickers.json');

export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;

let table = null;
let dirty = false;

const upper = (c) => String(c || '').trim().toUpperCase();
const isoNow = () => new Date().toISOString();

function load() {
  if (table) return table;
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(MASTER_FILE(), 'utf8'));
  } catch {
    raw = null;
  }
  if (raw?.byCusip) {
    table = { updatedAt: raw.updatedAt || null, byCusip: raw.byCusip, unresolved: raw.unresolved || {} };
    return table;
  }
  // first run: seed from the flat map the universe build used to write
  let flat = {};
  try {
    flat = require('../_data/cusip-tickers.json');
  } catch {
    flat = {};
  }
  const byCusip = {};
  for (const [c, t] of Object.entries(flat)) {
    if (t) byCusip[upper(c)] = { ticker: String(t).toUpperCase(), name: null, exchange: null, figi: null, validFrom: null, validTo: null, source: 'static', resolvedAt: null };
  }
  table = { updatedAt: null, byCusip, unresolved: {} };
  return table;
}

// Test seam.
export function resetSecurityMaster() {
  table = null;
  dirty = false;
}

export const securityEntry = (cusip) => load().byCusip[upper(cusip)] || null;
export const tickerFor = (cusip) => securityEntry(cusip)?.ticker || null;
export const isCusipLike = (s) => /^[A-Z0-9]{8,9}$/.test(String(s || ''));

// What to print for a security: its ticker, else the issuer name the filing
// carries (or the name the master learnt), else — only when nothing else is
// known — the identifier itself.
export function labelFor(cusip, issuer = null) {
  const e = securityEntry(cusip);
  return e?.ticker || issuer || e?.name || load().unresolved[upper(cusip)]?.name || upper(cusip);
}

// Record an answer from the resolver. `hit` is { ticker, name, exchange,
// figi } or null; a null keeps the identifier in the unresolved table with
// its attempt count, so the daily retry can be bounded and logged.
export function record(cusip, hit, { source = 'openfigi', name = null } = {}) {
  const t = load();
  const c = upper(cusip);
  if (hit?.ticker) {
    t.byCusip[c] = {
      ticker: String(hit.ticker).toUpperCase().replace(/\//g, '-'),
      name: hit.name || name || t.byCusip[c]?.name || null,
      exchange: hit.exchange || null,
      figi: hit.figi || null,
      validFrom: t.byCusip[c]?.validFrom || null,
      validTo: null,
      source,
      resolvedAt: isoNow(),
    };
    delete t.unresolved[c];
  } else {
    const u = t.unresolved[c] || { name: null, attempts: 0, lastTried: null, lastError: null };
    u.attempts += 1;
    u.lastTried = isoNow();
    if (name) u.name = name;
    if (hit?.error) u.lastError = String(hit.error).slice(0, 120);
    t.unresolved[c] = u;
  }
  dirty = true;
}

// Which of these identifiers need a lookup now: unknown ones, plus
// unresolved ones whose last attempt is older than RETRY_AFTER.
export function needsLookup(cusips, { now = Date.now(), retryAfterMs = RETRY_AFTER_MS } = {}) {
  const t = load();
  const out = [];
  const seen = new Set();
  for (const raw of cusips) {
    const c = upper(raw);
    if (!c || seen.has(c) || t.byCusip[c]) continue;
    seen.add(c);
    const u = t.unresolved[c];
    if (u?.lastTried && now - Date.parse(u.lastTried) < retryAfterMs) continue;
    out.push(c);
  }
  return out;
}

// The unresolved identifiers due for their daily retry, oldest attempt first.
export function retryQueue({ now = Date.now(), retryAfterMs = RETRY_AFTER_MS, limit = 200 } = {}) {
  const t = load();
  return Object.entries(t.unresolved)
    .filter(([, u]) => !u.lastTried || now - Date.parse(u.lastTried) >= retryAfterMs)
    .sort(([, a], [, b]) => String(a.lastTried || '').localeCompare(String(b.lastTried || '')))
    .slice(0, limit)
    .map(([c]) => c);
}

export function stats() {
  const t = load();
  return { resolved: Object.keys(t.byCusip).length, unresolved: Object.keys(t.unresolved).length, updatedAt: t.updatedAt };
}

// Write the master and the derived flat map. Builds call this once at the
// end; a request never does.
export function persist({ force = false } = {}) {
  const t = load();
  if (!dirty && !force) return false;
  t.updatedAt = isoNow();
  fs.mkdirSync(path.dirname(MASTER_FILE()), { recursive: true });
  fs.writeFileSync(MASTER_FILE(), JSON.stringify(t));
  if (!process.env.SECURITY_MASTER_FILE) {
    const flat = {};
    for (const [c, e] of Object.entries(t.byCusip).sort(([a], [b]) => (a < b ? -1 : 1))) if (e.ticker) flat[c] = e.ticker;
    fs.writeFileSync(FLAT_FILE(), JSON.stringify(flat));
  }
  dirty = false;
  return true;
}

// Bulk import of a flat { cusip: ticker } map (a migration, a manual fix).
export function importFlat(map, { source = 'static' } = {}) {
  for (const [c, ticker] of Object.entries(map || {})) if (ticker && !securityEntry(c)) record(c, { ticker }, { source });
}
