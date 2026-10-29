// Imports Senate PTR pages a person saved from efdsearch.senate.gov into the
// Congress filing store — the manual route while the site refuses the build
// (Akamai bot check since 2026-10-23; see docs/VERI-KAPSAMI-2026-10-28.md).
//
//   node scripts/import-senate-ptr.mjs <dir> [--manifest <csv>] [--force] [--dry-run]
//
// <dir> holds the report pages saved from a browser ("Webpage, HTML only":
// the page's own URL stays in the file, so the report id is read from it).
// Each page yields one entry S:<id> in api/_data/congress-filings.json with
// the same shape the nightly build writes (status ok/empty, tx[]); the next
// Congress build serves it like any other report and never re-fetches it.
//
// The filer's name and the filing date are read from the page ("The
// Honorable First Last", "Periodic Transaction Report for MM/DD/YYYY"). A
// manifest CSV with the header `id,first,last,filed` (and optionally `file`)
// fills or overrides them — handy when a page was saved without its header.
// A page whose id, name or date is still unknown is listed and the run
// writes nothing. An entry that already exists is kept unless --force.
import fs from 'node:fs';
import path from 'node:path';
import { parseSenatePage, SENATE_BASE } from '../api/_lib/congressParse.js';
import { files, readJson, writeJson } from '../api/_lib/congressStore.js';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};
const dir = argv.find((a) => !a.startsWith('--') && a !== opt('manifest'));
if (!dir || !fs.existsSync(dir)) {
  console.error('Usage: node scripts/import-senate-ptr.mjs <dir-of-saved-pages> [--manifest manifest.csv] [--force] [--dry-run]');
  process.exit(2);
}

// manifest.csv: id,first,last,filed[,file] — "file" matches a page by its
// base name when the page carries no id of its own
export function readManifest(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { byId: new Map(), byFile: new Map() };
  const cols = lines[0].split(',').map((c) => c.trim().toLowerCase());
  const byId = new Map();
  const byFile = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map((c) => c.trim());
    const row = Object.fromEntries(cols.map((c, i) => [c, cells[i] || '']));
    const entry = { id: row.id || null, first: row.first || null, last: row.last || null, filed: row.filed || null };
    if (entry.id) byId.set(entry.id, entry);
    if (row.file) byFile.set(path.basename(row.file), entry);
  }
  return { byId, byFile };
}

export function pageEntry(html, { fileName, manifest = { byId: new Map(), byFile: new Map() }, now = Date.now() } = {}) {
  const page = parseSenatePage(html);
  const fromFile = manifest.byFile.get(path.basename(fileName)) || null;
  const id = page.id || fromFile?.id || ((/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(fileName) || [])[0] ?? null);
  const fromId = id ? manifest.byId.get(id) || null : null;
  const pick = (k) => fromId?.[k] || fromFile?.[k] || page[k] || null;
  const first = pick('first');
  const last = pick('last');
  const filed = pick('filed');
  const missing = [!id && 'id', !first && 'first', !last && 'last', !filed && 'filed'].filter(Boolean);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filed || '')) if (filed) missing.push('filed (YYYY-MM-DD)');
  if (missing.length) return { fileName, id, missing };
  return {
    fileName,
    id,
    missing: [],
    entry: {
      ch: 'S',
      id,
      filed,
      first,
      last,
      stateDst: null,
      url: `${SENATE_BASE}/search/view/ptr/${id}/`,
      title: page.title || `Periodic Transaction Report for ${filed.slice(5, 7)}/${filed.slice(8, 10)}/${filed.slice(0, 4)}`,
      status: page.tx.length ? 'ok' : 'empty',
      tx: page.tx,
      readAt: new Date(now).toISOString(),
      source: 'manual',
    },
  };
}

const manifestPath = opt('manifest') || (fs.existsSync(path.join(dir, 'manifest.csv')) ? path.join(dir, 'manifest.csv') : null);
const manifest = readManifest(manifestPath ? fs.readFileSync(manifestPath, 'utf8') : '');
const pages = fs.readdirSync(dir).filter((f) => /\.html?$/i.test(f)).sort();
if (!pages.length) {
  console.error(`no .html page in ${dir}`);
  process.exit(2);
}

const state = readJson(files.filings(), { filings: {} });
const filings = state.filings || {};
const results = pages.map((f) => pageEntry(fs.readFileSync(path.join(dir, f), 'utf8'), { fileName: f, manifest }));
const bad = results.filter((r) => r.missing.length);
for (const r of bad) console.log(`  ${r.fileName}: cannot import — missing ${r.missing.join(', ')}${manifestPath ? '' : ' (add a manifest.csv: id,first,last,filed[,file])'}`);

let added = 0;
let kept = 0;
let replaced = 0;
for (const r of results.filter((x) => !x.missing.length)) {
  const key = `S:${r.id}`;
  const existing = filings[key];
  if (existing && !flag('force')) {
    kept++;
    console.log(`  ${r.fileName}: S:${r.id} already on record (${existing.status}, ${existing.tx?.length || 0} trades) — kept; --force replaces`);
    continue;
  }
  if (existing) replaced++;
  else added++;
  filings[key] = r.entry;
  console.log(`  ${r.fileName}: ${r.entry.first} ${r.entry.last}, filed ${r.entry.filed}, ${r.entry.tx.length} trade(s)${existing ? ' (replaced)' : ''}`);
}

console.log(`\n${pages.length} page(s): ${added} added, ${replaced} replaced, ${kept} kept, ${bad.length} not importable`);
if (bad.length) {
  console.log('::error::nothing written — fix the pages listed above or add them to the manifest');
  process.exit(1);
}
if (flag('dry-run')) {
  console.log('dry run — nothing written');
} else if (added + replaced) {
  writeJson(files.filings(), { ...state, updatedAt: new Date().toISOString(), filings });
  console.log(`wrote ${files.filings()}; the next Congress build serves these reports`);
}
