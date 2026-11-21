// Precomputes the insider rows the API serves (api/_lib/insiderStore.js
// readServed) once per deploy, so a cold function instance parses one file
// instead of normalising every foreign issuer's line against the price cache
// — the step that cost each new instance several seconds of CPU.
//
//   node scripts/build-insiders-served.mjs   → api/_data/insiders-served.json
//                                              api/_data/insiders-preview.json
//
// …and, from that dataset, the free preview of every insider tab
// (api/_lib/insiderPreview.js): the answer a signed-out reader gets, computed
// here by the endpoint's own function, so a cold instance does not have to
// load the dataset to give it.
//
// Run by the Vercel build (vercel.json buildCommand) and by `npm run build`.
// The output is a build artefact (gitignored): it is only valid for the
// inputs it was computed from, which the fingerprint records. A failure here
// never fails the deploy — without the file the API computes the rows at
// runtime exactly as before. The same holds for the preview: both files are
// build artefacts, and a preview that could not be built is removed, never
// left behind from an earlier run.
import fs from 'node:fs';
import { computeServed, servedFile, servedFingerprint } from '../api/_lib/insiderStore.js';
import { PREVIEW_TABS, PREVIEW_VERSION, dayOf, packPreview, previewFile, previewFingerprint, previewInstants } from '../api/_lib/insiderPreview.js';

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

// The free preview per tab and day, from the dataset just written (the
// endpoint reads it back through the store, as an instance would).
const previewStarted = Date.now();
const previewOut = previewFile();
try {
  fs.rmSync(previewOut, { force: true });
  const { answer } = await import('../api/_handlers/insider-feed.js');
  const byDay = {};
  let empty = false;
  for (const now of previewInstants()) {
    const day = (byDay[dayOf(now)] = {});
    for (const tab of PREVIEW_TABS) {
      // through JSON, as the response is: what is stored is what is sent
      const body = JSON.parse(JSON.stringify(await answer({ tab }, { free: true, now, prebuilt: false })));
      if (body.empty) empty = true;
      day[tab] = body;
    }
  }
  if (empty) throw new Error('no insider rows');
  const tmp = `${previewOut}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ version: PREVIEW_VERSION, fingerprint: previewFingerprint(), builtAt: new Date().toISOString(), days: Object.keys(byDay), tabs: packPreview(byDay) })
  );
  fs.renameSync(tmp, previewOut);
  const kb = (fs.statSync(previewOut).size / 1024).toFixed(0);
  console.log(`insiders-preview.json: ${PREVIEW_TABS.length} tabs × ${Object.keys(byDay).length} days, ${kb} KB, ${Date.now() - previewStarted}ms`);
} catch (e) {
  fs.rmSync(previewOut, { force: true });
  console.warn(`insiders-preview.json not built (${e?.message || e}) — the API will compute the preview at runtime`);
}
