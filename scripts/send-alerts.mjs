// Sends the email digest: new 13F filings from the funds on a reader's
// watchlist, the Form 4 trades a watched guru itself filed, and insider
// trades matching any filter the reader saved as an alert.
//
//   node scripts/send-alerts.mjs --dry-run    match and print (addresses masked), move nothing
//   node scripts/send-alerts.mjs --force      ignore the weekly cadence
//   node scripts/send-alerts.mjs              send
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required — reads every reader's
//                                             preferences, so it cannot use RLS
//   RESEND_API_KEY, ALERT_FROM                required to send; without the
//                                             key a real run exits 1 before
//                                             reading anyone (a dry run may)
//   SITE_URL                                  links in the body
//
// Who gets mail: readers whose notification_prefs.email_digest is true
// (opt-in, migrations/0004 + 0006). What they get: the funds on their
// watchlists rows plus the targets of their alerts rows. Delivery state is
// a high-water mark per reader (notification_prefs.filings_seen /
// filings_seen_acc / form4_seen / last_sent_at) and, for the older
// per-filter insider alerts, per alert row. Marks move only after a real
// send — never on a dry run.
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { svcSelect, svcUpdate, hasServiceKey } from '../api/_lib/auth.js';
import {
  matchFilings, matchInsiders, matchForm4, nextMark, renderDigest, digestSubject,
  recipients, filingTargets, watchTargets, dueForPrefs, maskEmail,
} from '../api/_lib/alerts.js';
import { CANONICAL_SITE } from '../api/_lib/site.js';
import { readServed } from '../api/_lib/insiderStore.js';
import { guruForm4Rows, foldDays } from '../api/_lib/guruForm4.js';
import { GURUS } from '../api/_lib/gurus.js';
import { filerPath } from '../api/_lib/slugs.js';

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const SITE = (process.env.SITE_URL || CANONICAL_SITE).replace(/\/$/, '');
const FROM = process.env.ALERT_FROM || '';
const MAIL_KEY = process.env.RESEND_API_KEY || '';
// the API host is overridable so a test can stand in for Resend
const RESEND = (process.env.RESEND_BASE_URL || 'https://api.resend.com').replace(/\/$/, '');

if (!hasServiceKey()) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — the digest cannot read anyone’s preferences.');
  process.exit(1);
}
// A real run without a mail key would read every opted-in reader for
// nothing; it stops here, before any read, so no address ever reaches a log.
if (!DRY && (!MAIL_KEY || !FROM)) {
  console.error('RESEND_API_KEY / ALERT_FROM are not set — a real run needs both (use --dry-run to match without sending).');
  process.exit(1);
}

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
  } catch {
    return fallback;
  }
};

const filings = read('client/public/filings.json', { rows: [] }).rows || [];
// through the insider store: current rows only, a superseded 4/A original never alerts
const insiderRows = readServed().rows;
if (!filings.length && !insiderRows.length) {
  console.log('Neither dataset is present — nothing to alert on.');
  process.exit(0);
}
const guruByCik = new Map(GURUS.map((g) => [String(g.cik).padStart(10, '0'), g]));
const form4Cache = new Map();
const form4Of = (cik) => {
  if (!form4Cache.has(cik)) form4Cache.set(cik, foldDays(guruForm4Rows(cik, { rows: insiderRows })));
  return form4Cache.get(cik);
};

async function send(to, subject, text) {
  const r = await axios.post(
    `${RESEND}/emails`,
    { from: FROM, to: [to], subject, text },
    { headers: { Authorization: `Bearer ${MAIL_KEY}` }, validateStatus: () => true, timeout: 15000 }
  );
  if (r.status >= 300) throw new Error(`resend HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return { id: r.data?.id };
}

// Opt-in readers only; their watchlists and alerts; their addresses from the
// profile table the signup trigger fills.
const prefs = await svcSelect('notification_prefs', {
  select: 'user_id,email_digest,digest_frequency,lang,filings_seen,filings_seen_acc,form4_seen,last_sent_at',
  email_digest: 'is.true',
});
const wanted = recipients(prefs);
if (!wanted.size) {
  console.log(`${DRY ? '[dry run] ' : ''}0 readers have opted into the digest — nothing to send.`);
  process.exit(0);
}
const ids = `in.(${[...wanted.keys()].join(',')})`;
const [watchlists, alerts, profiles] = await Promise.all([
  svcSelect('watchlists', { select: 'user_id,cik,name', user_id: ids }),
  svcSelect('alerts', { select: 'id,user_id,kind,target,label,filters,last_seen,last_fired_at', user_id: ids }),
  svcSelect('profiles', { select: 'id,email', id: ids }),
]);
const emailOf = new Map(profiles.map((p) => [p.id, p.email]));
const prefOf = new Map(prefs.map((p) => [p.user_id, p]));
const group = (rows) => {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.user_id)) m.set(r.user_id, []);
    m.get(r.user_id).push(r);
  }
  return m;
};
const watchOf = group(watchlists);
const alertsOf = group(alerts);

const now = new Date();
const today = now.toISOString().slice(0, 10);
let sent = 0;
let empty = 0;
let notDue = 0;
let failed = 0;
const prefMarks = [];
const alertMarks = [];

for (const [userId] of wanted) {
  const to = emailOf.get(userId);
  const pref = prefOf.get(userId);
  const mine = alertsOf.get(userId) || [];
  const watched = watchOf.get(userId) || [];
  if (!to || (!mine.length && !watched.length)) {
    empty++;
    continue;
  }
  if (!FORCE && !dueForPrefs(pref, now)) {
    notDue++;
    continue;
  }
  const lang = pref.lang === 'en' ? 'en' : 'tr';

  // 13F filings: the watchlist plus any filing alerts, one mark per reader
  const ciks = [...new Set([...watchTargets(watched), ...filingTargets(mine)])];
  const newFilings = ciks.length
    ? matchFilings(filings, { ciks, since: pref.filings_seen || today, seenAccessions: pref.filings_seen_acc || [] })
    : [];

  // Form 4 lines of the watched gurus, after the reader's mark
  const form4 = [];
  for (const cik of ciks) {
    const g = guruByCik.get(cik);
    if (!g) continue;
    for (const r of matchForm4(form4Of(cik), { since: pref.form4_seen || today })) form4.push({ ...r, guru: g.name, guruCik: cik });
  }
  form4.sort((a, b) => (a.f < b.f ? 1 : a.f > b.f ? -1 : 0));

  // the older per-filter insider alerts keep their own marks
  const insiderHits = [];
  for (const a of mine.filter((x) => x.kind === 'insider')) {
    const filters = { ...(a.filters || {}) };
    if (a.target && a.target !== '*') filters.tickers = [a.target];
    const hits = matchInsiders(insiderRows, filters, { since: a.last_seen || today });
    if (hits.length) {
      insiderHits.push(...hits);
      alertMarks.push({ id: a.id, last_seen: nextMark(hits, 'f', a.last_seen) });
    }
  }

  const payload = { filings: newFilings, form4, insiders: insiderHits, siteUrl: SITE, pathOf: filerPath };
  const subject = digestSubject(payload, lang);
  const body = renderDigest(payload, lang);
  if (!subject || !body) {
    empty++;
    continue;
  }

  if (DRY) {
    console.log(`\n--- ${maskEmail(to)} (${pref.digest_frequency}, ${lang})\n${subject}\n${body}`);
  } else {
    try {
      await send(to, subject, body);
    } catch (e) {
      failed++;
      console.error(`send failed for one reader: ${String(e.message || e)}`);
      continue; // marks stay where they were: the next run retries
    }
  }
  sent++;

  const fields = { last_sent_at: now.toISOString() };
  if (newFilings.length) {
    const newest = newFilings[0].filed;
    fields.filings_seen = nextMark(newFilings, 'filed', pref.filings_seen);
    // accessions of the newest day, so re-reading that day does not repeat
    fields.filings_seen_acc = newFilings.filter((f) => f.filed === newest).map((f) => f.acc);
    for (const a of mine.filter((x) => x.kind === 'filing')) alertMarks.push({ id: a.id, last_seen: fields.filings_seen });
  }
  if (form4.length) fields.form4_seen = nextMark(form4, 'f', pref.form4_seen);
  prefMarks.push({ user_id: userId, ...fields });
}

// Marks move only after a real send: never on a dry run.
if (!DRY) {
  for (const m of prefMarks) {
    const { user_id, ...fields } = m;
    await svcUpdate('notification_prefs', { user_id: `eq.${user_id}` }, fields);
  }
  for (const m of alertMarks) {
    const { id, ...fields } = m;
    await svcUpdate('alerts', { id: `eq.${id}` }, { ...fields, last_fired_at: now.toISOString() });
  }
}

console.log(
  `${DRY ? '[dry run] ' : ''}${wanted.size} opted-in readers: ${sent} digests${DRY ? ' matched' : ' sent'}, ${empty} had nothing new, ${notDue} not due yet (weekly), ${failed} failed, ${prefMarks.length + alertMarks.length} marks ${DRY ? 'left alone' : 'advanced'}`
);
process.exit(failed ? 1 : 0);
