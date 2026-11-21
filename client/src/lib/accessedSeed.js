// A lookup table handed to the server render whole, of which the page reads
// a few dozen entries (returns.json: 4,000 symbols, a page shows thirty).
// recordAccess() wraps it so the render can read any entry, and picked()
// answers with only the entries it did read — the part that goes into the
// HTML. An entry the page asked for and the table does not have is kept as
// null: "looked up, nothing there" is an answer the browser must not have to
// fetch the whole file to learn.
const SYMBOL_KEY = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;

export function recordAccess(table) {
  const seen = new Set();
  const own = (k) => Object.prototype.hasOwnProperty.call(table, k);
  // Only what can be a symbol is a lookup: the libraries the value passes
  // through probe it too (constructor, toJSON, then, $$typeof).
  const note = (k) => {
    if (typeof k === 'string' && (own(k) || SYMBOL_KEY.test(k))) seen.add(k);
  };
  const proxy = new Proxy(table, {
    get(target, k) {
      note(k);
      return target[k];
    },
    // `in` is only ever the page asking "do you answer for this one?"
    // (covers, below) — whatever it is called, a bond's "ECHO 3.875 11-30-30"
    // included — so it is always part of what the browser gets
    has(target, k) {
      if (typeof k === 'string') seen.add(k);
      return true;
    },
  });
  return {
    proxy,
    picked() {
      const out = {};
      for (const k of seen) out[k] = own(k) ? table[k] : null;
      return out;
    },
  };
}

// Whether a partial table (the seed above, in the browser) answers for every
// symbol in `needed`. Null entries count: they are answers. On the server
// the table is the recording proxy, which notes each symbol and says yes.
export function covers(seed, needed) {
  if (!seed || typeof seed !== 'object' || !Array.isArray(needed)) return false;
  for (const k of needed) {
    if (k && !(k in seed)) return false;
  }
  return true;
}
