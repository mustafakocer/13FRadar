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

// The Form 4 lines a watched guru itself filed (guruForm4.js rows, already
// joined to the fund) after the reader's mark — by filing date, like the
// insider mark, so a late filing of an old trade still arrives.
export function matchForm4(rows, { since = null } = {}) {
  return (rows || [])
    .filter((r) => !since || str(r.f) > since)
    .sort((a, b) => (a.f < b.f ? 1 : a.f > b.f ? -1 : a.d < b.d ? 1 : -1));
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
// reads correctly as text reads correctly everywhere. `pathOf(cik)` gives a
// fund's page path ('/guru/berkshire-…') for the links; without it the
// line carries the name only.
export function renderDigest({ filings = [], insiders = [], form4 = [], siteUrl = '', pathOf = null }, lang = 'en') {
  const tr = lang === 'tr';
  const base = siteUrl ? `${siteUrl.replace(/\/$/, '')}/${tr ? 'tr' : 'en'}` : '';
  const link = (cik) => (base && pathOf ? ` ${base}${pathOf(cik) || ''}` : '');
  const lines = [];
  if (filings.length) {
    lines.push(tr ? 'Takip ettiğiniz fonlardan yeni 13F bildirimleri:' : 'New 13F filings from funds you follow:');
    for (const f of filings.slice(0, 25)) {
      const amended = f.amended ? (tr ? ' (düzeltme)' : ' (amendment)') : '';
      const period = f.reportDate ? ` · ${tr ? 'dönem' : 'period'} ${f.reportDate}` : '';
      lines.push(`  · ${f.name} — ${tr ? 'bildirim' : 'filed'} ${f.filed}${period}${amended}${link(f.cik)}`);
    }
    lines.push('');
  }
  if (form4.length) {
    lines.push(tr ? 'Takip ettiğiniz ustaların Form 4 ile bildirdiği işlemler (çeyrek içi, tarihli):' : 'Trades your followed gurus reported on Form 4 (inside the quarter, dated):');
    for (const r of form4.slice(0, 25)) {
      const side = r.k === 'P' ? (tr ? 'alım' : 'buy') : r.k === 'S' ? (tr ? 'satış' : 'sale') : r.k;
      const shares = r.s ? ` ${Math.round(r.s).toLocaleString('en-US')} ${tr ? 'adet' : 'sh'}` : '';
      const price = r.p ? ` @ $${Number(r.p).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '';
      lines.push(`  · ${r.guru || r.n || ''}: ${r.t || '—'} ${side}${shares}${price} — ${r.d}${r.guruCik ? link(r.guruCik) : ''}`);
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
  if (siteUrl) lines.push(tr ? `Takip listeniz: ${base}/watchlist` : `Your watchlist: ${base}/watchlist`);
  lines.push(tr ? `Bu e-postayı Hesabım sayfasından kapatabilirsiniz${base ? `: ${base}/account` : ''}. Yatırım tavsiyesi değildir.` : `Turn this off on your account page${base ? `: ${base}/account` : ''}. Not investment advice.`);
  return lines.join('\n');
}

export function digestSubject({ filings = [], insiders = [], form4 = [] }, lang = 'en') {
  const tr = lang === 'tr';
  const parts = [];
  if (filings.length) parts.push(tr ? `${filings.length} yeni 13F` : `${filings.length} new 13F`);
  if (form4.length) parts.push(tr ? `${form4.length} Form 4 işlemi` : `${form4.length} Form 4 trades`);
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

// A weekly reader is due six days after the last digest (migrations/0006
// last_sent_at); a daily reader always; a reader never written to, always.
export function dueForPrefs(pref, now = new Date()) {
  if (pref?.digest_frequency !== 'weekly') return true;
  if (!pref?.last_sent_at) return true;
  return now.getTime() - Date.parse(pref.last_sent_at) >= 6 * 86400 * 1000;
}

// The CIKs on a reader's watchlist rows, padded, de-duplicated.
export function watchTargets(rows = []) {
  return [...new Set(rows.filter((r) => r?.cik).map((r) => str(r.cik).padStart(10, '0')))];
}

// Dry-run output must not print a reader's address: "m***@example.com".
export const maskEmail = (e) => {
  const [u, d] = str(e).split('@');
  return d ? `${u.slice(0, 1)}***@${d}` : '***';
};

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
