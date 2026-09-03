// @ts-check
// Feature flags. Every new module checks its flag so it can be switched off
// in production without a deploy rollback.
//   FEATURE_FLAGS="alerts=off,congress=off"   (server)
// Unknown flags default to ON.
const KNOWN = [
  'positionTimeline',
  'overlap',
  'alerts',
  'watchlists',
  'insiders',
  'congress',
  'performance',
  'screener',
  'backtest',
  'heatmap',
  'filings13dg',
  'themes',
  'exportApi',
  'turkeyRadar',
];

/** @param {string | undefined} raw */
export function parseFlags(raw) {
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const k of KNOWN) out[k] = true;
  for (const part of String(raw || '').split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (!k) continue;
    out[k] = v === undefined ? true : !/^(0|off|false|no)$/i.test(v);
  }
  return out;
}

/** @type {Record<string, boolean> | null} */
let cache = null;
/** @param {string} name */
export function flagOn(name) {
  if (!cache) cache = parseFlags(process.env.FEATURE_FLAGS);
  return cache[name] !== false;
}

/** Express/Vercel guard: responds 404 when the module is switched off.
 * @param {string} name @param {any} res */
export function requireFlag(name, res) {
  if (flagOn(name)) return true;
  res.status(404).json({ error: 'feature-disabled', feature: name });
  return false;
}
