// Pure helpers behind the page <head>: the server template and the client
// mirror (seo.jsx) share them, and they run under node:test without a DOM.
// A JSON-LD block is written into a <script> element, so a "<" in the data
// must not be able to close it. The same escaped form is used on the server
// and in the browser, so the two can be compared byte for byte.
export const scriptText = (text) => String(text).replace(/</g, '\\u003c');

// One line per head tag, attributes in a fixed order, so a tag rendered by
// the server and the same tag the browser would build compare equal.
export function tagSignature(t) {
  const entries = Object.entries(t)
    .filter(([k, v]) => k !== 'tag' && k !== 'data-seo' && v != null)
    .map(([k, v]) => [k, k === 'text' && t.tag === 'script' ? scriptText(v) : String(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${t.tag}|${entries.map(([k, v]) => `${k}=${v}`).join('|')}`;
}

// What the head already holds, in the same form as a page spec produces.
export function domTagSpec(el) {
  const t = { tag: el.tagName.toLowerCase() };
  for (const a of el.attributes) if (a.name !== 'data-seo') t[a.name] = a.value;
  if (t.tag === 'script') t.text = el.textContent;
  return t;
}

// The single head policy: the server writes the head; on hydration the
// client keeps what is there when it is what it would have written itself,
// and only replaces the set when the page's spec really differs (a
// client-side navigation, data that changed the title). Pure, so it can
// be tested without a DOM: `existing` are the tags currently marked
// data-seo, `desired` the tags the spec produces (title excluded).
export function planHead(existing, desired) {
  const have = existing.map(tagSignature);
  const want = desired.map(tagSignature);
  const same = have.length === want.length && have.every((s, i) => s === want[i]);
  return { same, replace: same ? [] : desired };
}

