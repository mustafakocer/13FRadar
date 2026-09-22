// What to print for a security when there is no ticker: the issuer name the
// 13F itself carries, shortened to fit a symbol cell — never the raw CUSIP,
// which means nothing to a reader. The full identifier stays available in
// `title` for anyone who wants it.

// "AMAZON COM INC" -> "Amazon Com Inc"
export const niceName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

const NOISE = /\b(inc|corp|corporation|co|ltd|plc|llc|lp|sa|nv|ag|holdings?|hldgs?|group|grp|trust|new|com|cl|class|[abc]|the|del|of)\b\.?/gi;

export function shortIssuer(issuer, max = 14) {
  const cleaned = niceName(String(issuer || '').replace(NOISE, ' ').replace(/\s+/g, ' ').trim());
  const base = cleaned || niceName(issuer);
  return base.length > max ? `${base.slice(0, max - 1).trimEnd()}…` : base;
}

// ticker, else the issuer, else the identifier — and whether it is a ticker
// (the caller decides whether that becomes a link).
export function securityLabel({ ticker, issuer, cusip } = {}) {
  if (ticker) return { text: ticker, isTicker: true, title: cusip || '' };
  const name = shortIssuer(issuer);
  return { text: name || cusip || '—', isTicker: false, title: [issuer, cusip].filter(Boolean).join(' · ') };
}
