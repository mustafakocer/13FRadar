// Sends the alert digest: new 13F filings from the funds a reader follows,
// and insider trades matching the filters they saved.
//
//   node scripts/send-alerts.mjs --dry-run    prints what would be sent
//   node scripts/send-alerts.mjs              sends it
//
// Env:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required — reads every user's
//                                             alerts, so it cannot use RLS
//   RESEND_API_KEY, ALERT_FROM                required to actually send
//   SITE_URL                                  links in the body
//
// Without a mail key the run still matches and reports; it just cannot post.
// That is the useful half in CI, and it is how this is verified without
// sending anyone an email.
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { svcSelect, svcUpdate, hasServiceKey } from '../api/_lib/auth.js';
import { matchFilings, matchInsiders, nextMark, renderDigest, digestSubject } from '../api/_lib/alerts.js';
import { CANONICAL_SITE } from '../api/_lib/site.js';

const DRY = process.argv.includes('--dry-run');
const SITE = (process.env.SITE_URL || CANONICAL_SITE).replace(/\/$/, '');
const FROM = process.env.ALERT_FROM || 'Fundocap <alerts@fundocap.com>';
const MAIL_KEY = process.env.RESEND_API_KEY || '';

if (!hasServiceKey()) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — the digest cannot read anyone’s alerts.');
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
const insiders = read('api/_data/insiders.json', { rows: [] }).rows || [];
if (!filings.length && !insiders.length) {
  console.error('Neither dataset is present — nothing to alert on.');
  process.exit(1);
}

async function send(to, subject, text) {
  if (!MAIL_KEY) return { skipped: 'no RESEND_API_KEY' };
  const r = await axios.post(
    'https://api.resend.com/emails',
    { from: FROM, to: [to], subject, text },
    { headers: { Authorization: `Bearer ${MAIL_KEY}` }, validateStatus: () => true, timeout: 15000 }
  );
  if (r.status >= 300) throw new Error(`resend HTTP ${r.status}: ${JSON.stringify(r.data)}`);
  return { id: r.data?.id };
}

// Everyone who has asked to hear from us. A reader with no preference row has
// not opted out — the default in the schema is on — so the join is a left one
// in spirit: prefs narrow the set, they do not define it.
const prefs = await svcSelect('notification_prefs', { select: 'user_id,email_enabled,cadence' });
const optedOut = new Set(prefs.filter((p) => !p.email_enabled).map((p) => p.user_id));

const alerts = await svcSelect('alerts', { select: '*', enabled: 'is.true' });
const watchRows = await svcSelect('watchlists', { select: 'user_id,cik,name' });

const byUser = new Map();
const touch = (id) => {
  if (!byUser.has(id)) byUser.set(id, { watch: [], alerts: [] });
  return byUser.get(id);
};
for (const w of watchRows) touch(w.user_id).watch.push(w);
for (const a of alerts) touch(a.user_id).alerts.push(a);

// Email addresses come from the profile table the signup trigger fills.
const profiles = await svcSelect('profiles', { select: 'id,email' });
const emailOf = new Map(profiles.map((p) => [p.id, p.email]));

let sent = 0;
let empty = 0;
const marks = [];

for (const [userId, bundle] of byUser) {
  if (optedOut.has(userId)) continue;
  const to = emailOf.get(userId);
  if (!to) continue;

  // One filing alert per reader, driven by the watchlist; its high-water mark
  // is stored on the alert row so a second run the same day repeats nothing.
  const filingAlert = bundle.alerts.find((a) => a.kind === 'filing');
  const ciks = bundle.watch.map((w) => w.cik);
  const newFilings = filingAlert || ciks.length
    ? matchFilings(filings, {
        ciks,
        since: filingAlert?.last_seen || null,
        seenAccessions: filingAlert?.params?.seen || [],
      })
    : [];

  const insiderHits = [];
  for (const a of bundle.alerts.filter((x) => x.kind === 'insider')) {
    const hits = matchInsiders(insiders, a.params || {}, { since: a.last_seen || null });
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

  if (DRY) {
    console.log(`\n--- ${to}\n${subject}\n${body}`);
  } else {
    const r = await send(to, subject, body);
    if (r.skipped) console.log(`${to}: ${subject} (not sent — ${r.skipped})`);
  }
  sent++;

  if (filingAlert && newFilings.length) {
    marks.push({
      id: filingAlert.id,
      last_seen: nextMark(newFilings, 'filed', filingAlert.last_seen),
      // accessions of the newest day, so re-reading that day does not repeat
      params: {
        ...(filingAlert.params || {}),
        seen: newFilings.filter((f) => f.filed === newFilings[0].filed).map((f) => f.acc),
      },
    });
  }
}

// Marks move only after a successful send, and never on a dry run.
if (!DRY && MAIL_KEY) {
  for (const m of marks) {
    const { id, ...fields } = m;
    await svcUpdate('alerts', { id: `eq.${id}` }, { ...fields, last_fired_at: new Date().toISOString() });
  }
}

console.log(
  `${DRY ? '[dry run] ' : ''}${sent} digests${MAIL_KEY ? '' : ' (no mail key — nothing posted)'}, ${empty} readers had nothing new, ${marks.length} marks ${DRY || !MAIL_KEY ? 'left alone' : 'advanced'}`
);
