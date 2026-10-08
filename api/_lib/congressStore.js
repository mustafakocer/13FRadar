// The one place Congress trading data is read and written.
//
//   api/_data/congress-filings.json   every PTR read so far, parsed (the
//                                     build's memory: a filing is fetched once)
//   api/_data/congress.json           what the site serves: members, rows,
//                                     last closes (bundled with the API)
//   api/_data/freshness/congress.json the dataset's health record
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const dataDir = () => process.env.CONGRESS_DATA_DIR || path.join(root, 'api', '_data');
export const files = {
  filings: () => path.join(dataDir(), 'congress-filings.json'),
  data: () => path.join(dataDir(), 'congress.json'),
  freshness: () => path.join(dataDir(), 'freshness', 'congress.json'),
};

const EMPTY = { updatedAt: null, since: null, counts: {}, members: {}, committees: {}, px: {}, rows: [] };

// The literal require path is what lets Vercel's tracer bundle the file.
let served = null;
export function readServed() {
  if (served) return served;
  let db = null;
  try {
    db = process.env.CONGRESS_DATA_DIR ? readJson(files.data(), null) : require('../_data/congress.json');
  } catch {
    db = null;
  }
  db = { ...EMPTY, ...(db || {}) };
  const bySlug = {};
  for (const [key, m] of Object.entries(db.members)) bySlug[m.slug] = key;
  // newest disclosure first, then newest trade
  const rows = db.rows.slice().sort((a, b) => (b.f || '').localeCompare(a.f || '') || (b.d || '').localeCompare(a.d || ''));
  served = { ...db, rows, bySlug };
  return served;
}
export const resetServedCache = () => {
  served = null;
};

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value, { pretty = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, pretty ? 1 : 0));
  fs.renameSync(tmp, file);
}
