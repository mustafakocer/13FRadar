// Backfills historical 13F filings and positions into the store.
//
//   node scripts/backfill-13f.mjs                 one bounded run
//   BACKFILL_QUARTERS=8 node scripts/…            more quarters this run
//   BACKFILL_DRY=1 node scripts/…                 read and count, write nothing
//
// Env: HISTORY_SUPABASE_URL / HISTORY_SUPABASE_KEY (or SUPABASE_URL and the
// service key), SEC_USER_AGENT, BACKFILL_QUARTERS (default 2),
// BACKFILL_FILINGS (per-quarter cap, default 0 = all).
//
// Report periods are left null by this pass. The quarterly index does not
// carry them, and deriving one from the index's own quarter would be a guess
// that is wrong for exactly the filings it matters most for — an amendment
// restates an arbitrary earlier period. They are filled from the submissions
// endpoint, one request per filer covering all of their filings, the same way
// scripts/build-filings.mjs does it.
//
// This is designed to be run over and over rather than once. Every run picks
// up at the stored cursor, reads a bounded number of quarters newest-first,
// and writes what it read; a run that dies halfway costs only the quarter it
// was in, because the next run sees which accessions are already stored and
// reads only the rest. Expect many runs: 2013 onward is roughly 115 million
// positions.
import axios from 'axios';
import { parse13F, aggregatePositions, fetchInfoTableXml } from '../api/_lib/sec.js';
import { parseFilingIndex } from '../api/_lib/filings.js';
import {
  quartersToBackfill,
  advanceCursor,
  chunk,
  missingFilings,
  holdingRows,
  parseQuarter,
} from '../api/_lib/backfillPlan.js';

const DRY = process.env.BACKFILL_DRY === '1';
const MAX_QUARTERS = Number(process.env.BACKFILL_QUARTERS || 2);
const MAX_FILINGS = Number(process.env.BACKFILL_FILINGS || 0);
const UA = process.env.SEC_USER_AGENT || 'Fundocap backfill (contact via fundocap.com)';

const dbUrl = (process.env.HISTORY_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
const dbKey = process.env.HISTORY_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!dbUrl || !dbKey) {
  console.error('No store configured — set HISTORY_SUPABASE_URL and HISTORY_SUPABASE_KEY.');
  process.exit(1);
}

const http = axios.create({ headers: { 'User-Agent': UA }, timeout: 60000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = axios.create({
  baseURL: `${dbUrl}/rest/v1`,
  headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
  timeout: 60000,
  validateStatus: () => true,
});

async function upsert(table, rows, onConflict) {
  if (DRY || !rows.length) return;
  for (const part of chunk(rows, 1000)) {
    const r = await db.post(`/${table}`, part, {
      params: { on_conflict: onConflict },
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (r.status >= 300) throw new Error(`${table} upsert HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  }
}

async function storedAccessions(quarterFilings) {
  const out = [];
  for (const part of chunk(quarterFilings.map((f) => f.acc), 300)) {
    const r = await db.get('/filings', { params: { acc: `in.(${part.join(',')})`, select: 'acc' } });
    if (r.status !== 200) throw new Error(`filings read HTTP ${r.status}`);
    out.push(...r.data.map((x) => x.acc));
  }
  return out;
}

async function readState() {
  const r = await db.get('/backfill_state', { params: { job: 'eq.13f', select: '*' } });
  return r.status === 200 ? r.data?.[0] || null : null;
}

async function writeState(cursor, finished, stats) {
  if (DRY) return;
  await upsert(
    'backfill_state',
    [{ job: '13f', cursor, done: finished, stats, updated_at: new Date().toISOString() }],
    'job'
  );
}

// The quarterly index lists every filing of every form for a quarter. It is
// the only way to enumerate historical 13Fs without walking every filer.
async function quarterIndex({ y, q }) {
  const url = `https://www.sec.gov/Archives/edgar/full-index/${y}/QTR${q}/form.idx`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await http.get(url, {
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
    });
    if (r.status === 200 && typeof r.data === 'string' && r.data.length > 1000) return r.data;
    if (r.status === 404) return null;
    await sleep(5000 * (attempt + 1));
  }
  throw new Error(`form.idx ${y}Q${q} unavailable`);
}

const state = await readState();
const quarters = quartersToBackfill({ from: state?.cursor, max: MAX_QUARTERS });
if (!quarters.length) {
  console.log(`Nothing left to backfill (cursor ${state?.cursor || 'unset'}, done=${state?.done ?? false}).`);
  process.exit(0);
}
console.log(`${DRY ? '[dry] ' : ''}Quarters this run: ${quarters.join(', ')}`);

const completed = [];
let totalFilings = 0;
let totalPositions = 0;
let failed = 0;

for (const key of quarters) {
  const qt = parseQuarter(key);
  const idx = await quarterIndex(qt);
  if (!idx) {
    console.log(`  ${key}: no index published`);
    completed.push(key);
    continue;
  }
  const listed = parseFilingIndex(idx);
  const already = await storedAccessions(listed);
  let todo = missingFilings(listed, already);
  if (MAX_FILINGS > 0) todo = todo.slice(0, MAX_FILINGS);
  console.log(`  ${key}: ${listed.length} filings listed, ${already.length} stored, reading ${todo.length}`);

  // Filers first: the filings table references them.
  const filers = new Map();
  for (const f of todo) filers.set(f.cik, { cik: f.cik, name: f.name, updated_at: new Date().toISOString() });
  await upsert('filers', [...filers.values()], 'cik');

  let quarterOk = true;
  for (const f of todo) {
    try {
      const xml = await fetchInfoTableXml(f.cik, f.acc);
      const parsed = await parse13F(xml);
      const { aum, positions, unitFix } = aggregatePositions(parsed, f.filed);
      await upsert(
        'filings',
        [
          {
            acc: f.acc,
            cik: f.cik,
            form: f.form,
            amended: f.amended,
            report_date: f.reportDate || null,
            filed: f.filed,
            aum: Math.round(aum),
            positions: positions.length,
            unit_fix: Boolean(unitFix),
          },
        ],
        'acc'
      );
      await upsert('holdings', holdingRows(f.acc, positions), 'acc,cusip,put_call');
      totalFilings++;
      totalPositions += positions.length;
    } catch (e) {
      failed++;
      quarterOk = false;
      console.warn(`    ${f.acc}: ${e.message}`);
    }
    if (totalFilings % 250 === 0 && totalFilings) console.log(`    …${totalFilings} filings, ${totalPositions} positions`);
    await sleep(130); // ~7 req/s
  }

  // Only a quarter that read cleanly counts as done; a quarter with failures
  // is left for the next run, which will read just the filings it is missing.
  if (quarterOk && (!MAX_FILINGS || todo.length < MAX_FILINGS)) completed.push(key);
}

const { cursor, finished } = advanceCursor(completed);
if (cursor) {
  await writeState(cursor, finished, {
    lastRun: new Date().toISOString(),
    filings: totalFilings,
    positions: totalPositions,
    failed,
  });
}
console.log(
  `${DRY ? '[dry] ' : ''}${totalFilings} filings, ${totalPositions} positions, ${failed} failed. Cursor → ${cursor || 'unchanged'}${finished ? ' (backfill complete)' : ''}`
);
