// Precomputes the insider rows the API serves (api/_lib/insiderStore.js
// readServed) once per deploy, so a cold function instance parses one file
// instead of normalising every foreign issuer's line against the price cache
// — the step that cost each new instance several seconds of CPU.
//
//   node scripts/build-insiders-served.mjs   → api/_data/insiders-served.json
//
// Run by the Vercel build (vercel.json buildCommand) and by `npm run build`.
// The output is a build artefact (gitignored): it is only valid for the
// inputs it was computed from, which the fingerprint records. A failure here
// never fails the deploy — without the file the API computes the rows at
// runtime exactly as before.
import fs from 'node:fs';
import { computeServed, servedFile, servedFingerprint } from '../api/_lib/insiderStore.js';

const started = Date.now();
try {
  const fingerprint = servedFingerprint();
  const served = computeServed();
  const out = servedFile();
  const tmp = `${out}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ fingerprint, builtAt: new Date().toISOString(), served }));
  fs.renameSync(tmp, out);
  const mb = (fs.statSync(out).size / 1e6).toFixed(1);
  console.log(`insiders-served.json: ${served.rows.length} rows, ${mb} MB, ${Date.now() - started}ms`);
} catch (e) {
  console.warn(`insiders-served.json not built (${e?.message || e}) — the API will compute the rows at runtime`);
}
