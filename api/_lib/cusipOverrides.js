// Hand-checked answers for identifiers neither OpenFIGI nor the SEC files
// settle (api/_lib/secSecurities.js). api/_data/cusip-overrides.json:
//   { "<CUSIP>": { "ticker": "X", "note": "where it was checked" }
//              | { "kind": "invalid|delisted|warrant|…", "reason": "…", "lastTicker"?: "X", "note": "…" } }
// A ticker here must be one the SEC's own files confirm (company or fund
// series ticker); the note says which.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '_data', 'cusip-overrides.json');

export function loadCusipOverrides(file = FILE) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = {};
    for (const [k, v] of Object.entries(raw)) if (!k.startsWith('_') && v && typeof v === 'object') out[k.toUpperCase()] = v;
    return out;
  } catch {
    return {};
  }
}
