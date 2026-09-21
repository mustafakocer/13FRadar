// A disk cache for the EDGAR documents the builds read: a filing's
// directory listing, its information table and its cover page. A filed
// document never changes and an amendment is a new accession, so an
// accession read once never needs the network again.
//
// The history build used to spend 8–9k requests a run re-reading the same
// forty quarters per guru; with the cache warm (GitHub Actions restores it
// between runs, see .github/workflows/consensus.yml) a run only fetches what
// EDGAR lists that the cache does not hold — a handful of new filings.
//
//   EDGAR_CACHE_DIR   where to keep it (default .cache/edgar, git-ignored);
//                     an empty string disables the cache
//   layout            <dir>/<cik>/<accession-no-dashes>/<name>
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIR = path.join(process.cwd(), '.cache', 'edgar');
// Off on Vercel (the deployment's filesystem is read-only and a request
// never walks filings anyway); on by default everywhere a build runs.
const dir = () => (process.env.EDGAR_CACHE_DIR === undefined ? (process.env.VERCEL ? '' : DEFAULT_DIR) : process.env.EDGAR_CACHE_DIR);

const counters = { hits: 0, misses: 0, writes: 0 };

const file = (cik, acc, name) => {
  const d = dir();
  if (!d) return null;
  const cikN = String(Number(String(cik).replace(/\D/g, '')));
  const accNo = String(acc).replace(/-/g, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  return path.join(d, cikN, accNo, name);
};

export function cacheGet(cik, acc, name) {
  const f = file(cik, acc, name);
  if (!f) return null;
  try {
    const text = fs.readFileSync(f, 'utf8');
    counters.hits++;
    return text;
  } catch {
    counters.misses++;
    return null;
  }
}

export function cacheHas(cik, acc, name) {
  const f = file(cik, acc, name);
  return Boolean(f && fs.existsSync(f));
}

export function cachePut(cik, acc, name, text) {
  const f = file(cik, acc, name);
  if (!f || typeof text !== 'string' || !text) return false;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // write-then-rename so a run killed mid-write never leaves a torn file
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, f);
    counters.writes++;
    return true;
  } catch {
    return false;
  }
}

export const cacheEnabled = () => Boolean(dir());

// Hit ratio and size, for the build log.
export function cacheStats() {
  const d = dir();
  let files = 0;
  let bytes = 0;
  if (d && fs.existsSync(d)) {
    const walk = (p) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const q = path.join(p, e.name);
        if (e.isDirectory()) walk(q);
        else if (!e.name.endsWith('.tmp')) {
          files++;
          bytes += fs.statSync(q).size;
        }
      }
    };
    try {
      walk(d);
    } catch {
      /* partial listing is fine for a log line */
    }
  }
  const asked = counters.hits + counters.misses;
  return { dir: d || null, ...counters, hitRate: asked ? counters.hits / asked : null, files, bytes };
}

export function resetCacheCounters() {
  counters.hits = 0;
  counters.misses = 0;
  counters.writes = 0;
}
