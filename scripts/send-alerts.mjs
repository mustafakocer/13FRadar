// Sends the alert digest: new 13F filings from the filers a reader has an
// alert on, and insider trades matching the filters they saved.
//
//   node scripts/send-alerts.mjs --dry-run    prints what would be sent
//   node scripts/send-alerts.mjs --force      ignore the weekly cadence
//   node scripts/send-alerts.mjs              sends it
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required — reads every user's
//                                             alerts, so it cannot use RLS
//   RESEND_API_KEY, ALERT_FROM                required to actually send
//   SITE_URL                                  links in the body
//
// Who gets mail: readers whose notification_prefs.email_digest is true (opt-in,
// migrations/0004_alerts). What they get: the targets in their alerts rows —
// kind 'filing' (a CIK) and kind 'insider' (a ticker or '*' with the saved
// filters). Without a mail key the run matches, reports what it would have
// sent, and exits 0: that is a configuration state, not a failure.
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { svcSelect, svcUpdate, hasServiceKey } from '../api/_lib/auth.js';
import { matchFilings, matchInsiders, nextMark, renderDigest, digestSubject, recipients, filingTargets, dueForDigest } from '../api/_lib/alerts.js';
import { CANONICAL_SITE } from '../api/_lib/site.js';

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const SITE = (process.env.SITE_URL || CANONICAL_SITE).replace(/\/$/, '');
const FROM = process.env.ALERT_FROM || 'Fundocap <alerts@fundocap.com>';
const MAIL_KEY = process.env.RESEND_API_KEY || '';

if (!hasServiceKey()) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — the digest cannot read anyone’s alerts.');
  process.exit(1);
}
if (!MAIL_KEY && !DRY) console.log('RESEND_API_KEY is not set — matching and reporting only, nothing will be sent.');

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8'));
  } catch {
    return fallback;
  }
};

const filings = read('client/public/filings.json', { rows: [] }).rows || [];
const insiders = read('api/_data/insiders.json', { rows: [] }).rows || [];
if (!filings.length && !insiders.length) {
  console.log('Neither dataset is present — nothing to alert on.');
  process.exit(0);
}

async function send(to, subject, text) {
  const r = await axios.post(
    'https://api.resend.com/emails',
    { from: FROM, to: [to], subject, text },
    { headers: { Authorization: `Bearer ${MAIL_KEY}` }, validateStatus: () => true, timeout: 15000 }
  );
  if (r.status >= 300) throw new Error(`resend HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return { id: r.data?.id };
}

// Opt-in readers only; their alerts; their addresses from the profile table
// the signup trigger fills.
const prefs = await svcSelect('notification_prefs', { select: 'user_id,email_digest,digest_frequency', email_digest: 'is.true' });
const wanted = recipients(prefs);
if (!wanted.size) {
  console.log(`${DRY ? '[dry run] ' : ''}0 readers have opted into the digest — nothing to send.`);
  process.exit(0);
}
const alerts = await svcSelect('alerts', { select: 'id,user_id,kind,target,label,filters,last_seen,last_fired_at', user_id: `in.(${[...wanted.keys()].join(',')})` });
const profiles = await svcSelect('profiles', { select: 'id,email', id: `in.(${[...wanted.keys()].join(',')})` });
const emailOf = new Map(profiles.map((p) => [p.id, p.email]));

const byUser = new Map();
for (const a of alerts) {
  if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
  byUser.get(a.user_id).push(a);
}

const now = new Date();
let sent = 0;
let empty = 0;
let notDue = 0;
const marks = [];

for (const [userId, frequency] of wanted) {
  const to = emailOf.get(userId);
  const mine = byUser.get(userId) || [];
  if (!to || !mine.length) {
    empty++;
    continue;
  }
  if (!FORCE && !dueForDigest(mine, frequency, now)) {
    notDue++;
    continue;
  }

  // Filing alerts share one high-water mark: the newest filing date already
  // reported across the reader's filers, plus that day's accessions.
  const filingAlerts = mine.filter((a) => a.kind === 'filing');
  const since = filingAlerts.map((a) => a.last_seen).filter(Boolean).sort().pop() || null;
  const seen = filingAlerts.flatMap((a) => a.filters?.seen || []);
  const newFilings = filingAlerts.length ? matchFilings(filings, { ciks: filingTargets(filingAlerts), since, seenAccessions: seen }) : [];

  const insiderHits = [];
  for (const a of mine.filter((x) => x.kind === 'insider')) {
    const filters = { ...(a.filters || {}) };
    if (a.target && a.target !== '*') filters.tickers = [a.target];
    const hits = matchInsiders(insiders, filters, { since: a.last_seen || null });
    if (hits.length) {
      insiderHits.push(...hits);
      marks.push({ id: a.id, last_seen: nextMark(hits, 'f', a.last_seen) });
    }
  }

  const payload = { filings: newFilings, insiders: insiderHits, siteUrl: SITE };
  const subject = digestSubject(payload);
  const body = renderDigest(payload);
  if (!subject || !body) {
    empty++;
    continue;
  }

  if (DRY || !MAIL_KEY) {
    console.log(`\n--- ${to} (${frequency})\n${subject}\n${body}`);
  } else {
    await send(to, subject, body);
  }
  sent++;

  if (newFilings.length) {
    const newest = newFilings[0].filed;
    for (const a of filingAlerts) {
      marks.push({
        id: a.id,
        last_seen: nextMark(newFilings, 'filed', a.last_seen),
        // accessions of the newest day, so re-reading that day does not repeat
        filters: { ...(a.filters || {}), seen: newFilings.filter((f) => f.filed === newest).map((f) => f.acc) },
      });
    }
  }
}

// Marks move only after a real send: never on a dry run, never without a key.
if (!DRY && MAIL_KEY) {
  for (const m of marks) {
    const { id, ...fields } = m;
    await svcUpdate('alerts', { id: `eq.${id}` }, { ...fields, last_fired_at: now.toISOString() });
  }
}

console.log(
  `${DRY ? '[dry run] ' : ''}${wanted.size} opted-in readers: ${sent} digests${MAIL_KEY && !DRY ? ' sent' : ' (not sent — no RESEND_API_KEY)'}, ${empty} had nothing new, ${notDue} not due yet (weekly), ${marks.length} marks ${DRY || !MAIL_KEY ? 'left alone' : 'advanced'}`
);
