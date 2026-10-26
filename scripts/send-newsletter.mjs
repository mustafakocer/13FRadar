// Mails the lead-magnet subscribers (migrations/0007_subscribers):
//   • the weekly Smart Money newsletter, Mondays, to confirmed readers who
//     ticked it (api/_lib/newsletter.js builds it from the nightly files)
//   • single-guru alerts, every run: a new 13F from a fund a reader follows
//
//   node scripts/send-newsletter.mjs --dry-run     build and print (addresses masked), move nothing
//   node scripts/send-newsletter.mjs --force       send the newsletter on any weekday
//   node scripts/send-newsletter.mjs --only=gurus  just the alerts (or --only=newsletter)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (reads every subscriber),
//      RESEND_API_KEY + LEAD_FROM (or ALERT_FROM) to send, SITE_URL for links.
// Marks (newsletter_sent_at, guru_seen) move only after a real send; addresses
// that never confirmed are deleted after 30 days.
import fs from 'node:fs';
import path from 'node:path';
import { svcSelect, svcUpdate, svcDelete, hasServiceKey } from '../api/_lib/auth.js';
import { mailConfigured, sendMail, unsubscribeUrl, unsubscribeHeaders, mailFooter } from '../api/_lib/leads.js';
import { buildNewsletter, renderNewsletter, guruAlertMail } from '../api/_lib/newsletter.js';
import { maskEmail } from '../api/_lib/alerts.js';
import { GURUS, guruByCik } from '../api/_lib/gurus.js';
import { filerPath } from '../api/_lib/slugs.js';
import { CANONICAL_SITE } from '../api/_lib/site.js';

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const SITE = (process.env.SITE_URL || CANONICAL_SITE).replace(/\/$/, '');
// Resend's default limit is 2 requests a second
const GAP_MS = Number(process.env.MAIL_GAP_MS ?? 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!hasServiceKey()) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — nobody to read.');
  process.exit(1);
}
if (!DRY && !mailConfigured()) {
  console.error('RESEND_API_KEY / LEAD_FROM are not set — a real run needs both (use --dry-run to build without sending).');
  process.exit(1);
}

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
  } catch {
    return fallback;
  }
};

// every confirmed subscriber, a page at a time (PostgREST caps a response)
async function confirmed() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await svcSelect('subscribers', {
      select: 'id,email,lang,newsletter,gurus,guru_seen,unsub_token,newsletter_sent_at',
      status: 'eq.confirmed',
      order: 'created_at.asc',
      limit: 1000,
      offset,
    });
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const now = new Date();
const subs = await confirmed();
const stats = { newsletter: 0, gurus: 0, failed: 0, skipped: 0 };

async function deliver(sub, mail) {
  if (DRY) {
    console.log(`\n--- ${maskEmail(sub.email)} (${sub.lang})\n${mail.subject}\n${mail.text.slice(0, 1200)}`);
    return true;
  }
  try {
    await sendMail({ to: sub.email, ...mail, headers: unsubscribeHeaders(SITE, sub.unsub_token) });
    await sleep(GAP_MS);
    return true;
  } catch (e) {
    stats.failed++;
    console.error(`send failed for one subscriber: ${String(e.message || e)}`);
    return false;
  }
}

// ------------------------------------------------------------ newsletter ---
const monday = now.getUTCDay() === 1;
if (ONLY !== 'gurus' && (monday || FORCE)) {
  const inputs = {
    teaser: read('client/public/insiders-teaser.json', {}),
    congress: read('api/_data/congress.json', {}),
    filings: read('client/public/filings.json', { rows: [] }).rows || [],
    gurus: GURUS,
    now,
    site: SITE,
    pathOf: filerPath,
  };
  const issues = { tr: buildNewsletter({ ...inputs, lang: 'tr' }), en: buildNewsletter({ ...inputs, lang: 'en' }) };
  const sixDays = 6 * 86400 * 1000;
  for (const sub of subs.filter((s) => s.newsletter)) {
    if (!FORCE && sub.newsletter_sent_at && now - Date.parse(sub.newsletter_sent_at) < sixDays) {
      stats.skipped++;
      continue;
    }
    const lang = sub.lang === 'en' ? 'en' : 'tr';
    const unsub = unsubscribeUrl(SITE, sub.unsub_token);
    const { text, html } = renderNewsletter(issues[lang], { unsub, footer: mailFooter(lang, unsub) });
    if (await deliver(sub, { subject: issues[lang].subject, text, html })) {
      stats.newsletter++;
      if (!DRY) await svcUpdate('subscribers', { id: `eq.${sub.id}` }, { newsletter_sent_at: now.toISOString() });
    }
  }
}

// ----------------------------------------------------------- guru alerts ---
if (ONLY !== 'newsletter') {
  const filings = read('client/public/filings.json', { rows: [] }).rows || [];
  const newest = new Map(); // cik → newest original 13F-HR
  for (const f of filings) {
    if (f.amended || !/^13F-HR/.test(f.form || '')) continue;
    const cik = String(f.cik).padStart(10, '0');
    const cur = newest.get(cik);
    if (!cur || f.filed > cur.filed) newest.set(cik, f);
  }
  for (const sub of subs.filter((s) => (s.gurus || []).length)) {
    const seen = { ...(sub.guru_seen || {}) };
    let moved = false;
    const lang = sub.lang === 'en' ? 'en' : 'tr';
    for (const cik of sub.gurus) {
      const f = newest.get(cik);
      if (!f) continue;
      if (!seen[cik]) {
        // first run for this follow: start from what is already out
        seen[cik] = f.filed;
        moved = true;
        continue;
      }
      if (f.filed <= seen[cik]) continue;
      const name = guruByCik(cik)?.name || f.name;
      const unsub = unsubscribeUrl(SITE, sub.unsub_token);
      const mail = guruAlertMail({ lang, name, filing: f, url: `${SITE}/${lang}${filerPath(cik)}` });
      if (await deliver(sub, { subject: mail.subject, text: `${mail.text}\n\n${mailFooter(lang, unsub)}` })) {
        stats.gurus++;
        seen[cik] = f.filed;
        moved = true;
      }
    }
    if (moved && !DRY) await svcUpdate('subscribers', { id: `eq.${sub.id}` }, { guru_seen: seen });
  }
}

// addresses that never confirmed are not kept: gone after 30 days
if (!DRY) {
  const cutoff = new Date(now.getTime() - 30 * 86400 * 1000).toISOString();
  await svcDelete('subscribers', { status: 'eq.pending', created_at: `lt.${cutoff}` }).catch((e) => console.error(`purge failed: ${e.message}`));
}

console.log(`${DRY ? '[dry run] ' : ''}${subs.length} confirmed subscribers · newsletter ${stats.newsletter} · guru alerts ${stats.gurus} · not due ${stats.skipped} · failed ${stats.failed}`);
if (stats.failed) process.exitCode = 1;
