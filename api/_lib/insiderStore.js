// The one place insider data is read and written.
//
// Today the store is JSON in the repository:
//   api/_data/insiders.json               rows the site serves (bundled with the API)
//   api/_data/insiders-raw.json           raw Form 4 fields per row, not served yet
//   api/_data/insider-ingest-errors.json  filings that could not be parsed
//   api/_data/freshness/insiders.json     the dataset's health record
// Every page, endpoint and script goes through this module, so moving to
// Supabase means rewriting this file, not hunting for readers.
//
// Row identity: (accession `a`, line index `li`). Writing a filing replaces
// every row that filing had — an upsert at filing granularity — so reading
// the same day twice changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { normalizeRows } from './fpiNormalize.js';
import { markCompensation } from './insiderNotes.js';
import { fpiContext, loadFpi, resetFpiCache } from './fpiContext.js';
import { refreshRole } from './insiderModel.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const dataDir = () => process.env.INSIDER_DATA_DIR || path.join(root, 'api', '_data');
export const files = {
  data: () => path.join(dataDir(), 'insiders.json'),
  raw: () => path.join(dataDir(), 'insiders-raw.json'),
  rawBackfill: () => path.join(dataDir(), 'insiders-raw-backfill.json'),
  errors: () => path.join(dataDir(), 'insider-ingest-errors.json'),
  freshness: () => path.join(dataDir(), 'freshness', 'insiders.json'),
  teaser: () => process.env.INSIDER_TEASER_FILE || path.join(root, 'client', 'public', 'insiders-teaser.json'),
};

// ------------------------------------------------------------ read (API)
// The literal require path is what lets Vercel's tracer bundle the file.
//
// Serving the rows means normalising every foreign issuer's line against the
// price cache (fpiNormalize.js) — several seconds of CPU on a cold function
// instance, paid again by every instance. The inputs are files fixed at
// deploy, so the build does it once (scripts/build-insiders-served.mjs →
// api/_data/insiders-served.json) and an instance only parses the result.
// The file carries the sizes of the inputs it was built from; a file built
// from other inputs (a local checkout that pulled new data) is ignored and
// the rows are computed here as before.
export const servedFile = () => path.join(dataDir(), 'insiders-served.json');
const SERVED_INPUTS = [
  () => files.data(),
  () => files.raw(),
  () => files.rawBackfill(),
  () => path.join(dataDir(), 'fpi.json'),
  () => path.join(dataDir(), 'ticker-meta.json'),
  () => path.join(root, 'config', 'adr-overrides.json'),
];
export function servedFingerprint() {
  return SERVED_INPUTS.map((f) => {
    try {
      return fs.statSync(f()).size;
    } catch {
      return null;
    }
  }).join(':');
}

function readPrebuilt() {
  // tests and dry runs point the store elsewhere; they always compute
  if (process.env.INSIDER_DATA_DIR || process.env.INSIDER_SERVED_OFF) return null;
  let file;
  try {
    file = require('../_data/insiders-served.json');
  } catch {
    return null;
  }
  return acceptPrebuilt(file, servedFingerprint());
}

// The prebuilt dataset when it was built from these inputs, else null.
export function acceptPrebuilt(file, fingerprint) {
  if (!file?.served?.rows) return null;
  if (file.fingerprint !== fingerprint) {
    console.warn(`insiders-served.json was built from other inputs (${file.fingerprint} ≠ ${fingerprint}) — computing the rows`);
    return null;
  }
  return file.served;
}

// The served dataset computed from the stored rows (what the build writes).
export function computeServed() {
  let db;
  try {
    db = process.env.INSIDER_DATA_DIR ? readJson(files.data(), null) : require('../_data/insiders.json');
  } catch {
    db = null;
  }
  db = db || { rows: [], companies: {}, updatedAt: null };
  // foreign issuers' lines in US dollars per US security, or marked as not
  // convertible (fpiNormalize.js); raw rows are not changed
  // …and a buy whose notes say the shares were pay is not an open-market
  // buy (insiderNotes.markCompensation)
  const raw = readRawServed();
  const rows = markCompensation(normalizeRows(currentRows(db.rows || []), fpiContext({ raw })), (r) => raw[`${r.a}:${r.li}`] || null);
  return { ...db, rows, lastFilingDay: lastFilingDay(rows) };
}

let served = null;
export function readServed() {
  if (served) return served;
  served = readPrebuilt() || computeServed();
  return served;
}
export const resetServedCache = () => {
  served = null;
  servedRaw = null;
  resetFpiCache();
};

// The raw Form 4 fields (security title, footnotes…) for the price check at
// read time (insiderPriceCheck.js). Loaded on first use; the literal require
// path lets Vercel bundle it (vercel.json includes it for api/index.js too).
let servedRaw = null;
export function readRawServed() {
  if (servedRaw) return servedRaw;
  try {
    servedRaw = (process.env.INSIDER_DATA_DIR ? readJson(files.raw(), null) : require('../_data/insiders-raw.json'))?.rows || {};
    // older lines: fields re-read by scripts/build-fpi.mjs (foreign issuers)
    // and scripts/backfill-insider-raw.mjs (recent open-market buys)
    let backfill = null;
    try {
      backfill = (process.env.INSIDER_DATA_DIR ? readJson(path.join(dataDir(), 'insiders-raw-backfill.json'), null) : require('../_data/insiders-raw-backfill.json'))?.rows;
    } catch {
      backfill = null;
    }
    const extra = loadFpi()?.raw;
    if (extra || backfill) servedRaw = { ...(backfill || {}), ...(extra || {}), ...servedRaw };
    // remarks re-read for lines whose other fields are in the nightly file
    for (const [id, x] of Object.entries(backfill || {})) if (x?.rm && servedRaw[id] && !servedRaw[id].rm) servedRaw[id] = { ...servedRaw[id], rm: x.rm };
  } catch {
    servedRaw = {};
  }
  return servedRaw;
}

// ------------------------------------------------------------ read/write (build)
export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

export function loadDataset() {
  const db = readJson(files.data(), { rows: [] });
  const rows = Array.isArray(db.rows) ? db.rows : [];
  assignLineIndexes(rows);
  // Before 2026-09-27 `lastDay` was the crawl checkpoint, and it was wrong:
  // it ran five business days past the data. Without a stored checkpoint the
  // newest filing day actually present is the only trustworthy one.
  const checkpoint = db.checkpoint || lastFilingDay(currentRows(rows)) || null;
  return { ...db, rows, checkpoint, companies: db.companies || {} };
}
export const loadRaw = () => readJson(files.raw(), { rows: {} });
// fields of older lines re-read by scripts/backfill-insider-raw.mjs
export const loadRawBackfill = () => readJson(files.rawBackfill(), { rows: {} }).rows || {};
export const loadErrors = () => readJson(files.errors(), { errors: [] });

export function saveDataset(db) {
  writeJson(files.data(), db);
}
export function saveRaw(raw, liveIds) {
  const rows = {};
  for (const [id, v] of Object.entries(raw.rows || {})) if (liveIds.has(id)) rows[id] = v;
  writeJson(files.raw(), { updatedAt: new Date().toISOString(), rows });
}
export function saveErrors(list, { keepDays = 60, now = Date.now() } = {}) {
  const since = new Date(now - keepDays * 86400000).toISOString();
  const byAcc = new Map();
  for (const e of list) if (e?.at >= since) byAcc.set(e.accession, e); // newest wins
  const errors = [...byAcc.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
  writeJson(files.errors(), { updatedAt: new Date(now).toISOString(), count: errors.length, errors });
}
export function saveTeaser(teaser) {
  writeJson(files.teaser(), teaser);
}

// The generic health record (same columns the future `data_freshness` table
// will have; 13F, prices and FMP will write their own file in this folder).
export function saveFreshness(record) {
  writeJson(files.freshness(), { dataset: 'insiders', ...record });
}

// ------------------------------------------------------------ row rules
export const rowId = (r) => `${r.a}:${r.li}`;

// Rows written before line indexes existed get one from their order inside
// the filing, which is the order the build appended them in.
export function assignLineIndexes(rows) {
  const next = new Map();
  for (const r of rows) if (r.li != null) next.set(r.a, Math.max(next.get(r.a) ?? 0, r.li + 1));
  for (const r of rows) {
    if (r.li != null) continue;
    const n = next.get(r.a) ?? 0;
    r.li = n;
    next.set(r.a, n + 1);
  }
  return rows;
}

// Upsert at filing granularity: every accession in `fresh` replaces all rows
// that accession had. Idempotent by construction.
export function mergeFilings(rows, freshRows, freshAccessions) {
  const replaced = new Set(freshAccessions);
  for (const r of freshRows) replaced.add(r.a);
  const kept = rows.filter((r) => !replaced.has(r.a));
  const byId = new Map();
  for (const r of [...kept, ...freshRows]) byId.set(rowId(r), r);
  return [...byId.values()];
}

// 4/A amendments. The original stays in the data, marked `sb` (superseded by)
// with the amendment's accession; every page, count and signal reads only the
// rows without `sb` (currentRows below).
//
// A row of a 4/A supersedes a row of an EARLIER filing (different accession,
// filed on or before the amendment) when all of these match:
//   · reporting owner — owner CIK (`ow`) when both rows have it, otherwise the
//     owner name, for rows stored before owner CIKs were kept
//   · issuer          — issuer CIK (`ci`)
//   · transaction date (`d`)
//   · transaction code (`k`)
//   · share count      (`s`)
// An amendment that corrects one of those five (a wrong share count, say)
// does not match, and both rows stay current — the known limit of this rule.
// Recomputed from scratch on every build, so it is idempotent.
export function markSuperseded(rows) {
  // `dp` marks a duplicate's `sb` (markDuplicates): cleared with it
  for (const r of rows) {
    delete r.sb;
    delete r.dp;
  }
  const keys = (r) => {
    const base = `${r.ci}|${r.d}|${r.k}|${r.s}`;
    const out = [`name:${String(r.n || '').trim().toUpperCase()}|${base}`];
    if (r.ow) out.push(`cik:${r.ow}|${base}`);
    return out;
  };
  const byKey = new Map();
  for (const r of rows) {
    for (const k of keys(r)) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }
  }
  let marked = 0;
  // oldest amendment first, so a chain 4 → 4/A → 4/A ends on the newest
  const amendments = rows.filter((r) => r.fa === '4/A').sort((a, b) => (a.f === b.f ? (a.a < b.a ? -1 : 1) : a.f < b.f ? -1 : 1));
  for (const am of amendments) {
    const candidates = new Set(keys(am).flatMap((k) => byKey.get(k) || []));
    for (const o of candidates) {
      if (o === am || o.a === am.a || o.sb || o.f > am.f) continue;
      // an owner CIK on both sides must agree; a name match only stands in
      // when one side predates owner CIKs
      if (o.ow && am.ow && o.ow !== am.ow) continue;
      o.sb = am.a;
      marked++;
    }
  }
  return marked;
}

// The same open-market trade filed twice. Run after markSuperseded: an
// amendment is matched first, and what is left are plain duplicates — the
// same Form 4 submitted twice the same day (FANG: SGF FANG Holdings' $1.86B
// sale under …-037009 and …-037010), or refiled months later as a plain "4"
// (AVR: L1 Capital's $28.75M buy, February and again in July). Counted
// twice, they added $2.97B of sales and $155M of buys to every total.
//
// A current open-market line (P or S with a price) is a duplicate of a line
// in an EARLIER filing (filed earlier, or the same day with a lower
// accession) when all of these match:
//   · issuer          — issuer CIK (`ci`), else the ticker
//   · reporting owner — owner CIK when both rows have it (two different CIKs
//     never match), otherwise the owner name, upper-cased, punctuation dropped
//   · transaction date, code, share count and price — exactly
// The earliest filing keeps its lines; a later one is marked `sb` with the
// keeper's accession and `dp: 1`, so every reader that already drops 4/A
// originals (currentRows, daySummary, buildClusters) drops it too.
// Conservative by construction:
//   · lines of one accession never mark each other — a filing may list two
//     identical lots
//   · a later filing loses at most as many lines per key as the keeper has:
//     two identical lots in the copy against one in the original marks one
//   · grants, withholding, gifts (no open-market price) are left alone: two
//     identical $0 awards on one day can be genuinely separate grants
// Recomputed from scratch on every build (markSuperseded clears `sb` first;
// this clears `dp`), so it is idempotent. → the number of lines marked
export const ownerName = (n) => String(n || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const filedOrder = (a, b) => (a.f === b.f ? (a.a < b.a ? -1 : a.a > b.a ? 1 : 0) : a.f < b.f ? -1 : 1);
export function markDuplicates(rows) {
  for (const r of rows) {
    if (r.dp) {
      delete r.sb;
      delete r.dp;
    }
  }
  const groups = new Map();
  for (const r of rows) {
    if (r.sb || !(r.k === 'P' || r.k === 'S') || !(r.p > 0) || !r.d) continue;
    const k = `${r.ci || r.t}|${ownerName(r.n)}|${r.d}|${r.k}|${r.s}|${r.p}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  let marked = 0;
  for (const lines of groups.values()) {
    if (lines.length < 2) continue;
    // the same name under two owner CIKs is two people: split by CIK, and a
    // line without one joins the (single) CIK group, if any
    const ciks = new Set(lines.map((r) => r.ow).filter(Boolean));
    const sets = ciks.size > 1 ? [...ciks].map((c) => lines.filter((r) => r.ow === c)) : [lines];
    for (const set of sets) {
      const byAcc = new Map();
      for (const r of [...set].sort(filedOrder)) {
        if (!byAcc.has(r.a)) byAcc.set(r.a, []);
        byAcc.get(r.a).push(r);
      }
      if (byAcc.size < 2) continue;
      const [keeper, ...later] = [...byAcc.values()];
      for (const copy of later) {
        for (const r of copy.slice(0, keeper.length)) {
          r.sb = keeper[0].a;
          r.dp = 1;
          marked++;
        }
      }
    }
  }
  return marked;
}

// Mirror pairs: one filing, one owner, one day, a P and an S of the same
// share count at the same price (PAMT: Moroun, 3,268,000 shares at $9.555
// bought and sold under one accession). That is a transfer between the
// owner's accounts or entities, not a purchase and a sale on the market, and
// counted both ways it added the same $31M to the buy AND the sell totals.
// Both lines stay in the data (and in the feed with "other types" on),
// marked `mx: 1`; insiderClassify.categorize reads them as 'other', so no
// open-market total, signal or cluster counts them. Pairs are matched one P
// to one S; a third identical line stays unmarked. → lines marked
export function markMirrors(rows) {
  for (const r of rows) delete r.mx;
  const groups = new Map();
  for (const r of rows) {
    if (r.sb || !(r.k === 'P' || r.k === 'S') || !(r.p > 0)) continue;
    const k = `${r.a}|${r.ow || ownerName(r.n)}|${r.d}|${r.s}|${r.p}`;
    if (!groups.has(k)) groups.set(k, { P: [], S: [] });
    groups.get(k)[r.k].push(r);
  }
  let marked = 0;
  for (const { P, S } of groups.values()) {
    const n = Math.min(P.length, S.length);
    for (let i = 0; i < n; i++) {
      P[i].mx = 1;
      S[i].mx = 1;
      marked += 2;
    }
  }
  return marked;
}

// Every derived mark on the stored rows, in the one order that is correct:
// roles under the current title rules, 4/A amendments, then duplicates of
// what is left, then mirror pairs among the current lines. Called by the
// nightly build and by scripts/build-insiders-marks.mjs (offline).
//   rawOf      r → raw Form 4 fields ({ dr, of, tp } relationship boxes)
//   companies  ticker → issuer name
export function markRows(rows, { rawOf = () => null, companies = {} } = {}) {
  let roles = 0;
  for (const r of rows) {
    const next = refreshRole(r, rawOf(r), { ticker: r.t, name: companies[r.t] || r.c || '' });
    if (next && next !== r.r) {
      r.r = next;
      roles++;
    }
  }
  const superseded = markSuperseded(rows);
  const duplicates = markDuplicates(rows);
  const mirrors = markMirrors(rows);
  return { roles, superseded, duplicates, mirrors };
}

export const currentRows = (rows) => rows.filter((r) => !r.sb);
export const lastFilingDay = (rows) => rows.reduce((m, r) => (r.f && r.f > m ? r.f : m), '') || null;

// Rows sharing a unique key — must always be empty (tests and the audit check it).
export function duplicateIds(rows) {
  const seen = new Set();
  const dups = [];
  for (const r of rows) {
    const id = rowId(r);
    if (seen.has(id)) dups.push(id);
    seen.add(id);
  }
  return dups;
}

// Same trade (issuer, owner, date, code, shares, price) under more than one
// current accession — what an unmarked amendment looks like.
export function sameTradeGroups(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = `${r.t}|${r.n}|${r.d}|${r.k}|${r.s}|${r.p}`;
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(r.a);
  }
  return [...m.entries()].filter(([, s]) => s.size > 1).map(([k, s]) => ({ key: k, accessions: [...s] }));
}
