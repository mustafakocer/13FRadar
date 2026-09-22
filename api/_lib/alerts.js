// What a reader is told about, and what they are told only once.
//
// The matching is pure so the digest job stays a thin shell around it: read
// rows, match, render, send, write back what was reported. Delivery state is
// a high-water mark per alert rather than a log of what was sent, because the
// only question at send time is "is there anything newer than last time".

export const ALERT_KINDS = ['filing', 'insider'];

const str = (v) => (v == null ? '' : String(v));

// New 13F filings from the filers on a watchlist.
//
// `since` is the alert's high-water mark: the filing date already reported.
// Filings on that same date are included — a filer can file after the digest
// ran — which is why the mark advances to the newest date seen and matches are
// de-duplicated by accession against `seenAccessions`.
export function matchFilings(filings, { ciks = [], since = null, seenAccessions = [] } = {}) {
  const want = new Set(ciks.map((c) => str(c).padStart(10, '0')));
  if (!want.size) return [];
  const seen = new Set(seenAccessions);
  return filings
    .filter((f) => f && want.has(str(f.cik).padStart(10, '0')))
    .filter((f) => !since || f.filed >= since)
    .filter((f) => !seen.has(f.acc))
    .sort((a, b) => (a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : 0));
}

// Insider transactions matching a saved set of filters. The params are the
// same ones /api/insider-feed takes, so an alert is literally the filter a
// reader was looking at when they saved it.
export function matchInsiders(rows, params = {}, { since = null } = {}) {
  const {
    tickers = [],
    roles = [],
    codes = [],
    minValue = 0,
    excludePlanned = false,
    clusterMin = 0,
  } = params;
  const wantTickers = new Set(tickers.map((t) => str(t).toUpperCase()));
  const wantRoles = new Set(roles);
  const wantCodes = new Set(codes.map((c) => str(c).toUpperCase()));
  return rows
    .filter((r) => {
      if (since && str(r.f) <= since) return false;
      if (wantTickers.size && !wantTickers.has(str(r.t).toUpperCase())) return false;
      if (wantRoles.size && !wantRoles.has(r.r)) return false;
      if (wantCodes.size && !wantCodes.has(str(r.k).toUpperCase())) return false;
      if (minValue && !(r.v >= minValue)) return false;
      if (excludePlanned && r.p5) return false;
      if (clusterMin && !(r.clusterInsiders >= clusterMin)) return false;
      return true;
    })
    .sort((a, b) => (a.f < b.f ? 1 : a.f > b.f ? -1 : (b.v || 0) - (a.v || 0)));
}

// The mark to store after reporting these rows: the newest date seen, so the
// next run starts there. Returns the existing mark unchanged when nothing
// matched — an empty run must not move time forward.
export function nextMark(matches, field, current = null) {
  let mark = current;
  for (const m of matches) {
    const v = str(m[field]);
    if (v && (!mark || v > mark)) mark = v;
  }
  return mark;
}

// Plain-text digest. Email clients mangle everything else, and a digest that
// reads correctly as text reads correctly everywhere.
export function renderDigest({ filings = [], insiders = [], siteUrl = '' }, lang = 'en') {
  const tr = lang === 'tr';
  const lines = [];
  if (filings.length) {
    lines.push(tr ? 'Takip ettiğiniz fonlardan yeni 13F bildirimleri:' : 'New 13F filings from funds you follow:');
    for (const f of filings.slice(0, 25)) {
      const amended = f.amended ? (tr ? ' (düzeltme)' : ' (amendment)') : '';
      lines.push(`  · ${f.name} — ${f.filed}${amended}`);
    }
    lines.push('');
  }
  if (insiders.length) {
    lines.push(tr ? 'Kayıtlı insider filtrenize uyan işlemler:' : 'Insider trades matching your saved filter:');
    for (const r of insiders.slice(0, 25)) {
      const value = r.v ? ` $${Math.round(r.v).toLocaleString('en-US')}` : '';
      lines.push(`  · ${r.t || '—'} ${r.n || ''} ${r.k}${value} — ${r.d}`);
    }
    lines.push('');
  }
  if (!lines.length) return null;
  if (siteUrl) lines.push(tr ? `Tümü: ${siteUrl}/tr/watchlist` : `See everything: ${siteUrl}/en/watchlist`);
  return lines.join('\n');
}

export function digestSubject({ filings = [], insiders = [] }, lang = 'en') {
  const tr = lang === 'tr';
  const parts = [];
  if (filings.length) parts.push(tr ? `${filings.length} yeni 13F` : `${filings.length} new 13F`);
  if (insiders.length) parts.push(tr ? `${insiders.length} insider işlemi` : `${insiders.length} insider trades`);
  if (!parts.length) return null;
  return `Fundocap — ${parts.join(', ')}`;
}

// ---- who, what, when (migrations/0004_alerts) ------------------------------

// Opt-in readers: Map user_id → digest_frequency, from notification_prefs
// rows. A row with email_digest false, or no row at all, is not a recipient.
export function recipients(prefs = []) {
  const out = new Map();
  for (const p of prefs) if (p?.user_id && p.email_digest === true) out.set(p.user_id, p.digest_frequency === 'daily' ? 'daily' : 'weekly');
  return out;
}

// The CIKs a reader's filing alerts point at, padded, de-duplicated.
export function filingTargets(alerts = []) {
  return [...new Set(alerts.filter((a) => a?.kind === 'filing' && a.target).map((a) => str(a.target).padStart(10, '0')))];
}

// A weekly reader is due when nothing was sent to them in the last six
// days (the job runs daily; six keeps a Monday send on Mondays); a daily
// reader is always due. The newest last_fired_at across the reader's alerts
// is the last send.
export function dueForDigest(alerts = [], frequency = 'weekly', now = new Date()) {
  if (frequency !== 'weekly') return true;
  let last = null;
  for (const a of alerts) if (a?.last_fired_at && (!last || a.last_fired_at > last)) last = a.last_fired_at;
  if (!last) return true;
  return now.getTime() - Date.parse(last) >= 6 * 86400 * 1000;
}
