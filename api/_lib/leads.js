import crypto from 'node:crypto';
import axios from 'axios';
import { CANONICAL_SITE } from './site.js';

// Lead magnets: what a reader can leave an address for, the double opt-in
// around it, and the signed links that hand the magnet over. The database
// side is migrations/0007_subscribers; the endpoints are _handlers/leads.js;
// the weekly mail is scripts/send-newsletter.mjs.
//
// Env:
//   RESEND_API_KEY        mail delivery (the same key the digest uses)
//   LEAD_FROM             "Fundocap <bulten@fundocap.co>"; falls back to ALERT_FROM
//   LEAD_SECRET           signs download grants; falls back to a key derived
//                         from SUPABASE_SERVICE_ROLE_KEY so nothing new is required
//   RESEND_BASE_URL       a stand-in during tests

// The magnets. `report:<id>` and `guru:<cik>` carry a parameter.
const SIMPLE = ['newsletter', 'xl-consensus', 'xl-insiders', 'match'];

export function parseMagnet(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (SIMPLE.includes(s)) return { id: s, kind: s };
  let m = /^report:(\d{4}-q[1-4])$/.exec(s);
  if (m) return { id: s, kind: 'report', report: m[1] };
  m = /^guru:(\d{1,10})$/.exec(s);
  if (m) {
    const cik = m[1].padStart(10, '0');
    return { id: `guru:${cik}`, kind: 'guru', cik };
  }
  return null;
}

export function normalizeEmail(raw) {
  const e = String(raw || '').trim().toLowerCase();
  if (e.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  return e;
}

export const newToken = () => crypto.randomBytes(24).toString('base64url');

// ---------------------------------------------------------- rate limit ---
// At most 3 confirmation mails per address per day, at least a minute apart:
// the form must not become a way to flood a stranger's inbox.
export const CONFIRM_MAX_PER_DAY = 3;
export const CONFIRM_MIN_GAP_MS = 60 * 1000;

export function confirmAllowed(row, now = Date.now()) {
  if (!row?.confirm_sent_at) return { ok: true, sends: 1 };
  const last = Date.parse(row.confirm_sent_at);
  if (!Number.isFinite(last)) return { ok: true, sends: 1 };
  if (now - last < CONFIRM_MIN_GAP_MS) return { ok: false, reason: 'too-soon' };
  const sameDay = now - last < 24 * 3600 * 1000;
  const sends = sameDay ? (row.confirm_sends || 0) + 1 : 1;
  if (sends > CONFIRM_MAX_PER_DAY) return { ok: false, reason: 'daily-cap' };
  return { ok: true, sends };
}

// --------------------------------------------------------------- merge ---
// What a new request adds to an existing row: magnets and gurus accumulate,
// the newsletter is only ever switched on here (off is the unsubscribe link).
export function mergeRequest(row, { magnet, newsletter }) {
  const magnets = [...new Set([...(row?.magnets || []), magnet.id])].slice(-20);
  const gurus = [...new Set([...(row?.gurus || []), ...(magnet.kind === 'guru' ? [magnet.cik] : [])])].slice(0, 25);
  return {
    magnets,
    gurus,
    newsletter: Boolean(row?.newsletter && row?.status !== 'unsubscribed') || Boolean(newsletter) || magnet.kind === 'newsletter',
  };
}

// ------------------------------------------------------- signed grants ---
// A grant unlocks the downloadable magnets for 30 days. It names nobody: it
// is proof that an address behind it confirmed, not a key to the address.
const GRANT_DAYS = 30;
function secret() {
  if (process.env.LEAD_SECRET) return process.env.LEAD_SECRET;
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return base ? crypto.createHmac('sha256', base).update('fundocap-lead-grant-v1').digest('hex') : '';
}

export function signGrant(now = Date.now(), days = GRANT_DAYS) {
  const key = secret();
  if (!key) return null;
  const exp = Math.floor(now / 1000) + days * 86400;
  const sig = crypto.createHmac('sha256', key).update(`grant.${exp}`).digest('base64url').slice(0, 32);
  return `${exp}.${sig}`;
}

export function verifyGrant(token, now = Date.now()) {
  const key = secret();
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{32})$/.exec(String(token || ''));
  if (!key || !m) return false;
  if (Number(m[1]) * 1000 < now) return false;
  const want = Buffer.from(crypto.createHmac('sha256', key).update(`grant.${m[1]}`).digest('base64url').slice(0, 32));
  const got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

// ---------------------------------------------------------------- mail ---
const resendBase = () => (process.env.RESEND_BASE_URL || 'https://api.resend.com').replace(/\/$/, '');
export const mailFrom = () => process.env.LEAD_FROM || process.env.ALERT_FROM || '';
export const mailConfigured = () => Boolean(process.env.RESEND_API_KEY && mailFrom());

export async function sendMail({ to, subject, text, html, headers }) {
  if (!mailConfigured()) throw new Error('mail not configured');
  const r = await axios.post(
    `${resendBase()}/emails`,
    { from: mailFrom(), to: [to], subject, text, ...(html ? { html } : {}), ...(headers ? { headers } : {}) },
    { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, validateStatus: () => true, timeout: 15000 }
  );
  if (r.status >= 300) throw new Error(`resend HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return { id: r.data?.id || null };
}

export const unsubscribeUrl = (site, token) => `${site}/api/unsubscribe?t=${encodeURIComponent(token)}`;
export const unsubscribeHeaders = (site, token) => ({
  'List-Unsubscribe': `<${unsubscribeUrl(site, token)}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

// HTML-escape for the few values that reach a mail body.
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// --------------------------------------------------------------- copy ---
const MAGNET_NAMES = {
  tr: {
    newsletter: 'Haftalık Akıllı Para Bülteni',
    report: 'Çeyreklik 13F raporu (PDF)',
    'xl-consensus': 'Ustaların en çok sahip olduğu 50 hisse (Excel)',
    'xl-insiders': 'Son 30 günün insider alımları (Excel)',
    match: 'Portföy–usta eşleşmesinin tam listesi',
    guru: 'Yeni 13F bildirim uyarısı',
  },
  en: {
    newsletter: 'Weekly Smart Money Newsletter',
    report: 'Quarterly 13F report (PDF)',
    'xl-consensus': 'The 50 stocks superinvestors own most (Excel)',
    'xl-insiders': 'Insider buys of the last 30 days (Excel)',
    match: 'The full portfolio–guru match',
    guru: 'New 13F filing alert',
  },
};
export const magnetName = (magnet, lang = 'tr') => MAGNET_NAMES[lang === 'en' ? 'en' : 'tr'][magnet.kind] || magnet.id;

const FOOTER = {
  tr: (unsub) => `—\nFundocap · KOCERLER LTD (Birleşik Krallık)\nVeriler SEC EDGAR ve kamuya açık kaynaklardan derlenir; yatırım tavsiyesi değildir.\nAbonelikten çık: ${unsub}`,
  en: (unsub) => `—\nFundocap · KOCERLER LTD (United Kingdom)\nData compiled from SEC EDGAR and public sources; not investment advice.\nUnsubscribe: ${unsub}`,
};
export const mailFooter = (lang, unsub) => FOOTER[lang === 'en' ? 'en' : 'tr'](unsub);

// The confirmation: one link, what it is for, what happens if ignored.
export function confirmMail({ lang, magnet, newsletter, confirmUrl, site = CANONICAL_SITE }) {
  const name = magnetName(magnet, lang);
  if (lang === 'en') {
    const extra = newsletter && magnet.kind !== 'newsletter' ? '\nYou also asked for the weekly Smart Money Newsletter.' : '';
    const text = `Hi 👋\n\nOne click and it's yours: ${name}.${extra}\n\nConfirm your email:\n${confirmUrl}\n\nDidn't ask for this? Ignore this mail — nothing more will be sent to you.\n\n—\nFundocap · ${site}`;
    return { subject: `Confirm your email · ${name}`, text, html: simpleHtml(text, confirmUrl, 'Confirm my email ✅') };
  }
  const extra = newsletter && magnet.kind !== 'newsletter' ? '\nHaftalık Akıllı Para Bülteni’ni de istedin.' : '';
  const text = `Merhaba 👋\n\nTek tık kaldı: ${name}.${extra}\n\nE-postanı onayla:\n${confirmUrl}\n\nBunu sen istemediysen bu e-postayı yok say; sana başka bir şey gönderilmez.\n\n—\nFundocap · ${site}`;
  return { subject: `E-postanı onayla · ${name}`, text, html: simpleHtml(text, confirmUrl, 'E-postamı onayla ✅') };
}

// After confirming (or when a confirmed reader asks again): the links.
export function deliveryMail({ lang, magnets, links, unsub, site = CANONICAL_SITE }) {
  const lines = magnets.map((m) => {
    const url = links[m.id];
    return url ? `• ${magnetName(m, lang)}: ${url}` : `• ${magnetName(m, lang)}`;
  });
  const hasNews = magnets.some((m) => m.kind === 'newsletter');
  const hasGuru = magnets.some((m) => m.kind === 'guru');
  if (lang === 'en') {
    const notes = [hasNews ? 'The newsletter arrives every Monday morning 📬' : '', hasGuru ? 'We will mail you as soon as the fund files a new 13F 🔔' : ''].filter(Boolean).join('\n');
    const text = `You're in 🎉\n\n${lines.join('\n')}\n${notes ? `\n${notes}\n` : ''}\nDownload links work for 30 days.\n\nWant every portfolio, trade and insider move? ${site}/en/pricing\n\n${mailFooter('en', unsub)}`;
    return { subject: 'Here you go 🎉 · Fundocap', text };
  }
  const notes = [hasNews ? 'Bülten her pazartesi sabahı gelir 📬' : '', hasGuru ? 'Fon yeni 13F verdiği anda sana yazacağız 🔔' : ''].filter(Boolean).join('\n');
  const text = `Hoş geldin 🎉\n\n${lines.join('\n')}\n${notes ? `\n${notes}\n` : ''}\nİndirme linkleri 30 gün geçerli.\n\nTüm portföyler, alım-satımlar ve insider akışı için: ${site}/tr/pricing\n\n${mailFooter('tr', unsub)}`;
  return { subject: 'İşte istediğin 🎉 · Fundocap', text };
}

// The button takes the link's place in the text, so "Confirm your email:"
// is followed by it, not by a blank line with the button after the footer.
function simpleHtml(text, url, button) {
  const cta = `<p style="margin:16px 0"><a href="${esc(url)}" style="background:#1B2A6B;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">${esc(button)}</a></p><p style="font-size:12px;color:#667;margin:0 0 8px">${esc(url)}</p>`;
  const [before, ...rest] = esc(text).split(esc(url));
  const br = (s) => s.replace(/^\n+|\n+$/g, '').replace(/\n/g, '<br>');
  const body = rest.length ? `${br(before)}${cta}${br(rest.join(esc(url)))}` : `${br(before)}${cta}`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#14182b;max-width:520px">${body}</div>`;
}
