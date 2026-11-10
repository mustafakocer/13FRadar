// The weekly business figures, mailed to the owner (api/_lib/metrics.js):
// accounts, Pro subscriptions, newsletter readers and how each moved.
//
//   node scripts/send-metrics.mjs --dry-run   count and print the mail, send nothing
//   node scripts/send-metrics.mjs             count and mail it to METRICS_TO
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (counts every account),
//      RESEND_API_KEY + LEAD_FROM (or ALERT_FROM) and METRICS_TO to send.
//      METRICS_TO: one address, or several separated by commas.
//
// The repository and its workflow logs are public. Inside GitHub Actions this
// script never prints a figure or an address — a dry run there says only that
// the tables were read. Run a dry run on your own machine to read the mail.
import { svcSelect, hasServiceKey } from '../api/_lib/auth.js';
import { mailConfigured, sendMail, normalizeEmail } from '../api/_lib/leads.js';
import { METRIC_READS, STRIPE_WINDOW_DAYS, summarizeMetrics, renderMetricsMail } from '../api/_lib/metrics.js';

const DRY = process.argv.includes('--dry-run');
const PUBLIC_LOG = process.env.GITHUB_ACTIONS === 'true';
const now = Date.now();

const recipients = String(process.env.METRICS_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
const to = recipients.map(normalizeEmail);

if (!hasServiceKey()) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is not set — nothing to count.');
  process.exit(1);
}
if (!DRY) {
  const missing = [];
  if (!mailConfigured()) missing.push('RESEND_API_KEY / LEAD_FROM');
  if (!recipients.length) missing.push('METRICS_TO');
  if (missing.length) {
    console.error(`${missing.join(' and ')} not set — a real run needs them (use --dry-run to count without sending).`);
    process.exit(1);
  }
  if (to.some((e) => !e)) {
    // the value itself stays out of the log
    console.error(`METRICS_TO holds ${to.filter((e) => !e).length} value(s) that are not an email address.`);
    process.exit(1);
  }
}

// every row of a table, a page at a time (PostgREST caps a response); the
// order ends on the primary key so no row falls between two pages
async function all(table, params) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await svcSelect(table, { ...params, limit: 1000, offset });
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const since = new Date(now - STRIPE_WINDOW_DAYS * 86400000).toISOString();
let rows;
try {
  rows = await Promise.all([
    all('profiles', { ...METRIC_READS.profiles, order: 'created_at.asc,id.asc' }),
    all('subscribers', { ...METRIC_READS.subscribers, order: 'created_at.asc,id.asc' }),
    all('stripe_events', { ...METRIC_READS.stripe_events, processed_at: `gte.${since}`, order: 'processed_at.asc,id.asc' }),
    all('watchlists', { ...METRIC_READS.watchlists, order: 'user_id.asc,cik.asc' }),
    all('notification_prefs', { ...METRIC_READS.notification_prefs, order: 'user_id.asc' }),
  ]);
} catch (e) {
  // the message only: an uncaught network error prints the whole request,
  // service key included
  console.error(`could not read the tables: ${String(e?.message || e)}`);
  process.exit(1);
}
const [profiles, subscribers, stripeEvents, watchlists, digestPrefs] = rows;

const mail = renderMetricsMail(summarizeMetrics({ profiles, subscribers, stripeEvents, watchlists, digestPrefs, now }));

if (DRY) {
  if (PUBLIC_LOG) console.log(`[dry run] five tables read, a ${mail.text.split('\n').length}-line mail built — not printed: this log is public.`);
  else console.log(`[dry run] nothing sent\n\n${mail.subject}\n\n${mail.text}`);
  process.exit(0);
}

let failed = 0;
for (const address of to) {
  try {
    await sendMail({ to: address, ...mail });
  } catch (e) {
    failed++;
    console.error(`send failed for one recipient: ${String(e.message || e)}`);
  }
}
console.log(`metrics mail: ${to.length - failed} sent, ${failed} failed`);
if (failed) process.exit(1);
