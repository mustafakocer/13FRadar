// Facts read straight out of a filing's own document (inline XBRL, the
// tagged numbers inside the HTML SEC serves), for the filers whose newest
// periods are not in companyfacts: some 20-F filers (TSM, Toyota, Sony) have
// only their cover share count there for 2025–2026. Pure: the build fetches
// the document and hands in its text.
//
// Returns companyfacts-shaped facts for the concepts asked, non-dimensional
// contexts only (a fact for one segment or share class is not the company's):
//   { facts: { 'ifrs-full': { DilutedEarningsLossPerShare: { units: { 'TWD/shares': [{ start, end, val, form, filed, accn }] } } } } }

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i')) || tag.match(new RegExp(`\\s${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? m[1] : null;
};
const local = (q) => String(q || '').replace(/^.*:/, '');

// contexts: id → { start, end, instant, dimensional }
export function parseContexts(html) {
  const out = new Map();
  const re = /<(?:xbrli:)?context\b[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/gi;
  let m;
  while ((m = re.exec(html))) {
    const id = attr(m[0].slice(0, m[0].indexOf('>') + 1), 'id');
    if (!id) continue;
    const body = m[1];
    const pick = (t) => body.match(new RegExp(`<(?:xbrli:)?${t}>\\s*([0-9-]{10})\\s*</(?:xbrli:)?${t}>`, 'i'))?.[1] || null;
    out.set(id, {
      start: pick('startDate'),
      end: pick('endDate'),
      instant: pick('instant'),
      dimensional: /<(?:xbrli:)?(segment|scenario)\b/i.test(body),
    });
  }
  return out;
}

// units: id → "TWD/shares" | "TWD" | "shares"
export function parseUnits(html) {
  const out = new Map();
  const re = /<(?:xbrli:)?unit\b[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/gi;
  let m;
  while ((m = re.exec(html))) {
    const id = attr(m[0].slice(0, m[0].indexOf('>') + 1), 'id');
    const measures = [...m[1].matchAll(/<(?:xbrli:)?measure>\s*([^<\s]+)\s*<\/(?:xbrli:)?measure>/gi)].map((x) => local(x[1]).toUpperCase() === 'SHARES' ? 'shares' : local(x[1]).toUpperCase());
    if (!id || !measures.length) continue;
    out.set(id, /divide/i.test(m[1]) && measures.length === 2 ? `${measures[0]}/${measures[1]}` : measures[0]);
  }
  return out;
}

// The number an ix:nonFraction states: its text, the scale, the sign.
export function factValue(tag, text) {
  const fmt = (attr(tag, 'format') || '').toLowerCase();
  let t = String(text || '').replace(/<[^>]+>/g, '').trim();
  if (/zero|fixed-zero/.test(fmt) || t === '-' || t === '—') return 0;
  // ixt:num-comma-decimal (1.234,56) vs the usual num-dot-decimal (1,234.56)
  t = /comma-?decimal/.test(fmt) ? t.replace(/[.\s]/g, '').replace(',', '.') : t.replace(/[,\s]/g, '');
  let v = Number(t);
  if (!Number.isFinite(v)) return null;
  const scale = Number(attr(tag, 'scale') || 0);
  if (scale) v *= 10 ** scale;
  if (attr(tag, 'sign') === '-') v = -v;
  return v;
}

// concepts: ['ifrs-full:DilutedEarningsLossPerShare', 'us-gaap:NetIncomeLoss', …]
// The cover share count is the one dimensional fact taken: a filer with
// several classes states one line per class (Berkshire's Class A and B),
// and the per-ticker class rule turns them into the listed share's units.
const COVER = 'dei:EntityCommonStockSharesOutstanding';

export function inlineFacts(html, concepts, { form = null, filed = null, accn = null } = {}) {
  const wanted = new Set(concepts);
  const contexts = parseContexts(html);
  const units = parseUnits(html);
  const facts = {};
  let coverTotal = false;
  const re = /<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = `<ix:nonFraction${m[1]}>`;
    const name = attr(tag, 'name');
    if (!wanted.has(name)) continue;
    const ctx = contexts.get(attr(tag, 'contextRef'));
    if (!ctx || (ctx.dimensional && (name !== COVER || coverTotal))) continue;
    const unit = units.get(attr(tag, 'unitRef'));
    const val = factValue(tag, m[2]);
    if (!unit || val == null) continue;
    const [ns, concept] = name.split(':');
    const entry = { ...(ctx.start ? { start: ctx.start } : {}), end: ctx.end || ctx.instant, val, form, filed, accn };
    const bucket = (((facts[ns] ||= {})[concept] ||= { units: {} }).units[unit] ||= []);
    if (!bucket.some((e) => e.start === entry.start && e.end === entry.end && e.val === entry.val)) bucket.push(entry);
    // a plain total next to the per-class lines would count twice: keep the total
    if (name === COVER && !ctx.dimensional) {
      coverTotal = true;
      bucket.splice(0, bucket.length, entry);
    }
  }
  return { facts };
}
