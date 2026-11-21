// The insider feed's free preview, answered without the dataset.
//
// A signed-out reader's /api/insider-feed answer (and the rows the server
// renders into /insiders) depends on three things only: the files the
// deployment carries, the tab, and the UTC day (the one-year window and the
// foreign-issuer window both end "today"). So the build computes it once per
// tab for the build day and the days after it — with the very function the
// endpoint runs (insider-feed.js `answer`) — and writes the results to
// api/_data/insiders-preview.json. A cold instance then answers the preview
// from that small file instead of parsing the 22 MB dataset and the 20 MB raw
// Form 4 fields and classifying 88,000 rows first.
//
// The file is used only when it was built from the inputs this instance
// carries (the fingerprint) and holds the requested day; in every other case
// — a filter, a page, a Pro request, a deployment older than the days it
// covers, a local checkout that pulled new data, no file at all — the
// endpoint computes the answer from the dataset exactly as before.
//
// It holds nothing a signed-out reader is not already sent: the answers are
// the free preview's own bodies.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { servedFile, servedFingerprint } from './insiderStore.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

export const PREVIEW_VERSION = 1;
export const PREVIEW_TABS = ['latest', 'ceo', 'cfo', 'cluster', 'penny', 'sells'];
// The build day and the three after it. Production is rebuilt at least twice
// a day by the insider jobs (scripts/vercel-ignore.mjs caps the gap at 12
// hours), so a day past the last one means a stalled pipeline — and then the
// endpoint simply computes, as it did before this file existed.
export const PREVIEW_DAYS = 4;
const DAY = 86400000;

export const previewFile = () => path.join(root, 'api', '_data', 'insiders-preview.json');
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
// The instants the build computes for: noon UTC of the build day and of each
// day after it (any instant of a day gives that day's answer).
export const previewInstants = (now = Date.now(), days = PREVIEW_DAYS) =>
  Array.from({ length: days }, (_, i) => Date.parse(`${dayOf(now)}T12:00:00Z`) + i * DAY);

// What the answers were computed from: the dataset's own inputs (the same
// sizes insiders-served.json is checked against) and the built dataset.
export function previewFingerprint() {
  let served = null;
  try {
    served = fs.statSync(servedFile()).size;
  } catch {
    served = null;
  }
  return `${servedFingerprint()}|${served}`;
}

// { day: { tab: body } } → the stored form: per tab the first day's body in
// full, and for each later day only the top-level fields that differ (as a
// rule `total` alone: a trade from a year ago leaving the window).
export function packPreview(byDay) {
  const days = Object.keys(byDay).sort();
  const tabs = {};
  for (const tab of Object.keys(byDay[days[0]] || {})) {
    const base = byDay[days[0]][tab];
    const later = {};
    for (const day of days.slice(1)) {
      const body = byDay[day]?.[tab];
      if (!body) continue;
      const set = {};
      for (const [k, v] of Object.entries(body)) if (JSON.stringify(v) !== JSON.stringify(base[k])) set[k] = v;
      const drop = Object.keys(base).filter((k) => !(k in body));
      later[day] = drop.length ? { set, drop } : { set };
    }
    tabs[tab] = { day: days[0], body: base, later };
  }
  return tabs;
}

// One tab's body for one day out of the stored form, or null.
export function unpackPreview(tabs, tab, day) {
  const t = tabs && Object.hasOwn(tabs, tab) ? tabs[tab] : null;
  if (!t?.body) return null;
  if (t.day === day) return { ...t.body };
  const p = t.later && Object.hasOwn(t.later, day) ? t.later[day] : null;
  if (!p) return null;
  const body = { ...t.body, ...p.set };
  for (const k of p.drop || []) delete body[k];
  return body;
}

// The stored file when it can be trusted for this instance, else null.
export function acceptPreview(file, fingerprint) {
  if (!file || file.version !== PREVIEW_VERSION || !file.tabs) return null;
  if (file.fingerprint !== fingerprint) {
    console.warn(`insiders-preview.json was built from other inputs (${file.fingerprint} ≠ ${fingerprint}) — computing the preview`);
    return null;
  }
  return file.tabs;
}

let loaded; // undefined = not looked at yet, null = unusable
export const resetPreviewCache = () => {
  loaded = undefined;
};
function tabsOnFile() {
  if (loaded !== undefined) return loaded;
  let file = null;
  try {
    // the literal path is what lets Vercel's tracer bundle the file
    file = process.env.INSIDER_PREVIEW_FILE ? JSON.parse(fs.readFileSync(process.env.INSIDER_PREVIEW_FILE, 'utf8')) : require('../_data/insiders-preview.json');
  } catch {
    file = null;
  }
  loaded = file ? acceptPreview(file, previewFingerprint()) : null;
  return loaded;
}

// The free preview of `tab` as of `now`, or null when the dataset has to
// answer. Tests and dry runs that point the store or the teaser elsewhere
// always compute.
export function readPreview(tab, now = Date.now()) {
  if (process.env.INSIDER_PREVIEW_OFF || process.env.INSIDER_DATA_DIR || process.env.INSIDER_SERVED_OFF || process.env.INSIDER_TEASER_FILE) return null;
  if (!PREVIEW_TABS.includes(tab)) return null;
  return unpackPreview(tabsOnFile(), tab, dayOf(now));
}
