// The files fpiNormalize.js works from, loaded once per process:
//   api/_data/fpi.json          rates, FPI issuers + ADR ratios, closes, raw
//                               fields of older lines (scripts/build-fpi.mjs)
//   config/adr-overrides.json   reviewed manual corrections, by ticker
//   api/_data/ticker-meta.json  52-week range, the fallback market check
// Literal require paths, so Vercel's tracer bundles them (vercel.json lists
// them for api/index.js as well). INSIDER_DATA_DIR / ADR_OVERRIDES_FILE /
// TICKER_META_FILE point tests at fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readSeries } from './priceStore.js';
import { loadSplits } from './splitAdjust.js';

const require = createRequire(import.meta.url);
const readFile = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

let fpi;
export function loadFpi() {
  if (fpi !== undefined) return fpi;
  try {
    fpi = process.env.INSIDER_DATA_DIR ? readFile(path.join(process.env.INSIDER_DATA_DIR, 'fpi.json')) : require('../_data/fpi.json');
  } catch {
    fpi = null;
  }
  return fpi;
}

let overrides;
export function loadOverrides() {
  if (overrides !== undefined) return overrides;
  try {
    const o = process.env.ADR_OVERRIDES_FILE ? readFile(process.env.ADR_OVERRIDES_FILE) : require('../../config/adr-overrides.json');
    overrides = o?.byTicker || {};
  } catch {
    overrides = {};
  }
  return overrides;
}

let meta;
export function loadMeta() {
  if (meta !== undefined) return meta;
  try {
    meta = process.env.TICKER_META_FILE ? readFile(process.env.TICKER_META_FILE) || {} : require('../_data/ticker-meta.json');
  } catch {
    meta = {};
  }
  return meta;
}

export const resetFpiCache = () => {
  fpi = undefined;
  overrides = undefined;
  meta = undefined;
};

// Daily closes for a ticker: the price cache, else the closes build-fpi
// kept for FPI trade days.
export function seriesWithFpi(seriesFor = (t) => readSeries(t)?.prices || null, data = loadFpi()) {
  return (t) => {
    const s = seriesFor(t);
    if (s?.length) return s;
    const c = data?.closes?.[t];
    return c?.length ? c.map(([date, close]) => ({ date, close })) : null;
  };
}

// The context normalizeRows needs. `raw` is the served raw-field store
// (insiders-raw.json); older FPI lines' fields come from fpi.json.
export function fpiContext({ raw = {}, seriesFor, meta: m } = {}) {
  const data = loadFpi();
  const extra = data?.raw || {};
  return {
    fpi: data,
    overrides: loadOverrides(),
    rawOf: (r) => raw[`${r.a}:${r.li}`] || extra[`${r.a}:${r.li}`] || null,
    seriesFor: seriesWithFpi(seriesFor, data),
    meta: m || loadMeta(),
    splits: loadSplits(),
  };
}
