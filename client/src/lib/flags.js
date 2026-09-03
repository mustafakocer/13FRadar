// Client feature flags — mirrors api/_lib/flags.js.
//   VITE_FEATURE_FLAGS="congress=off"
// Unknown flags default to ON.
function parse(raw) {
  const out = {};
  for (const part of String(raw || '').split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim());
    if (!k) continue;
    out[k] = v === undefined ? true : !/^(0|off|false|no)$/i.test(v);
  }
  return out;
}
const flags = parse(import.meta.env.VITE_FEATURE_FLAGS);
export const flagOn = (name) => flags[name] !== false;
