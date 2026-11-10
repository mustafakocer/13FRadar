// The weekly business figures (scripts/send-metrics.mjs): how many accounts,
// how many of them Pro, how many newsletter readers, and which way each moved
// this week. Pure: rows in, counts out, then a plain-text mail.
//
// The repository is public, and so are its workflow logs, run summaries and
// issues. These numbers therefore leave by mail to the owner only
// (METRICS_TO) and are never printed in a workflow. Nothing here reads or
// writes an address: the queries select no `email` column and the report
// holds counts alone.
//
// What it cannot know: revenue (Stripe's dashboard has it — a profile says
// "pro", not which of the six prices) and visits (GA4 / Vercel Web
// Analytics). The mail says so rather than guess.

const DAY = 86400000;
const str = (v) => (v == null ? '' : String(v));
const at = (iso) => {
  const t = Date.parse(str(iso));
  return Number.isFinite(t) ? t : null;
};
// rows whose `field` falls in [from, to)
const between = (rows, field, from, to) =>
  rows.filter((r) => {
    const t = at(r?.[field]);
    return t != null && t >= from && t < to;
  }).length;

const tally = (rows, keyOf) => {
  const out = {};
  for (const r of rows) {
    const k = keyOf(r);
    if (k) out[k] = (out[k] || 0) + 1;
  }
  return Object.entries(out).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
};

// plan = 'pro' and no expiry, or one still ahead: migrations/0001_rls is_pro()
export const isProRow = (p, now) => p?.plan === 'pro' && (p.plan_expires == null || (at(p.plan_expires) ?? -Infinity) > now);

// The columns each read needs — and no more: no address, no token, no id
// beyond the one that says two watchlist rows belong to one account.
export const METRIC_READS = {
  profiles: { select: 'plan,plan_expires,created_at' },
  subscribers: { select: 'status,newsletter,lang,source,magnets,created_at,confirmed_at,unsubscribed_at' },
  stripe_events: { select: 'type,outcome,processed_at' },
  watchlists: { select: 'user_id' },
  notification_prefs: { select: 'user_id', email_digest: 'eq.true' },
};
// Stripe deliveries older than this are not needed for a 30-day figure
export const STRIPE_WINDOW_DAYS = 35;

export function summarizeMetrics({ profiles = [], subscribers = [], stripeEvents = [], watchlists = [], digestPrefs = [], now = Date.now() } = {}) {
  const w7 = now - 7 * DAY;
  const w14 = now - 14 * DAY;
  const w30 = now - 30 * DAY;

  const active = profiles.filter((p) => isProRow(p, now));
  const applied = (type) => stripeEvents.filter((e) => e?.type === type && e.outcome === 'applied');
  const started = applied('checkout.session.completed');
  const ended = applied('customer.subscription.deleted');
  const failed = stripeEvents.filter((e) => e?.type === 'invoice.payment_failed');

  const confirmed = subscribers.filter((s) => s?.status === 'confirmed');
  const recent = subscribers.filter((s) => (at(s?.created_at) ?? -Infinity) >= w30);
  const kindOf = (id) => str(id).split(':')[0];

  return {
    asOf: new Date(now).toISOString().slice(0, 10),
    accounts: {
      total: profiles.length,
      new7: between(profiles, 'created_at', w7, now),
      prev7: between(profiles, 'created_at', w14, w7),
      new30: between(profiles, 'created_at', w30, now),
    },
    pro: {
      active: active.length,
      share: profiles.length ? active.length / profiles.length : null,
      // an open-ended grant (no expiry) is not a Stripe subscription
      openEnded: active.filter((p) => p.plan_expires == null).length,
      // a subscription renews on this day or lapses on it
      due7: active.filter((p) => p.plan_expires != null && at(p.plan_expires) <= now + 7 * DAY).length,
      // plan still says pro after its expiry: the webhook has not caught up
      lapsed: profiles.filter((p) => p?.plan === 'pro' && !isProRow(p, now)).length,
      started7: between(started, 'processed_at', w7, now),
      started30: between(started, 'processed_at', w30, now),
      ended7: between(ended, 'processed_at', w7, now),
      ended30: between(ended, 'processed_at', w30, now),
      paymentFailed7: between(failed, 'processed_at', w7, now),
    },
    subscribers: {
      confirmed: confirmed.length,
      pending: subscribers.filter((s) => s?.status === 'pending').length,
      unsubscribed: subscribers.filter((s) => s?.status === 'unsubscribed').length,
      newsletter: confirmed.filter((s) => s.newsletter).length,
      confirmed7: between(confirmed, 'confirmed_at', w7, now),
      prevConfirmed7: between(confirmed, 'confirmed_at', w14, w7),
      confirmed30: between(confirmed, 'confirmed_at', w30, now),
      unsubscribed30: between(subscribers, 'unsubscribed_at', w30, now),
      // of the addresses left in the last 30 days, the share that confirmed
      confirmRate30: recent.length ? recent.filter((s) => s.status === 'confirmed').length / recent.length : null,
      byLang: tally(confirmed, (s) => s.lang),
      bySource: tally(confirmed, (s) => kindOf(s.source)).slice(0, 6),
      byMagnet: tally(
        confirmed.flatMap((s) => [...new Set((Array.isArray(s.magnets) ? s.magnets : []).map(kindOf))]),
        (k) => k
      ),
    },
    activation: {
      withWatchlist: new Set(watchlists.map((w) => w?.user_id).filter(Boolean)).size,
      digestOptIn: digestPrefs.length,
    },
  };
}

const n = (x) => Number(x || 0).toLocaleString('tr-TR');
const signed = (x) => (x > 0 ? `+${n(x)}` : n(x));
const pct = (x, digits = 1) => (x == null ? '—' : `%${(x * 100).toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`);
const list = (pairs) => (pairs.length ? pairs.map(([k, v]) => `${k} ${n(v)}`).join(' · ') : '—');

// { subject, text } — Turkish, plain text, counts only.
export function renderMetricsMail(m) {
  const { accounts: a, pro: p, subscribers: s, activation: v } = m;
  const lines = [
    `Fundocap haftalık rakamlar — ${m.asOf}`,
    '',
    'HESAPLAR',
    `  Toplam: ${n(a.total)}`,
    `  Son 7 gün: ${signed(a.new7)} (önceki 7 gün: ${signed(a.prev7)})`,
    `  Son 30 gün: ${signed(a.new30)}`,
    '',
    'PRO',
    `  Aktif: ${n(p.active)} (hesapların ${pct(p.share)}'i)`,
    `  Yeni abonelik: 7 günde ${n(p.started7)}, 30 günde ${n(p.started30)}`,
    `  Biten abonelik: 7 günde ${n(p.ended7)}, 30 günde ${n(p.ended30)}`,
    `  7 gün içinde yenilenecek ya da bitecek: ${n(p.due7)}`,
    `  Başarısız tahsilat (7 gün): ${n(p.paymentFailed7)}`,
    ...(p.openEnded ? [`  Süresiz (elle verilmiş) Pro: ${n(p.openEnded)}`] : []),
    ...(p.lapsed ? [`  DİKKAT: süresi geçmiş ama planı hâlâ "pro" yazan hesap: ${n(p.lapsed)} (Stripe webhook'una bak)`] : []),
    '',
    'BÜLTEN VE LEAD',
    `  Onaylı: ${n(s.confirmed)} (bülten alan: ${n(s.newsletter)})`,
    `  Son 7 gün onaylanan: ${signed(s.confirmed7)} (önceki 7 gün: ${signed(s.prevConfirmed7)})`,
    `  Son 30 gün onaylanan: ${signed(s.confirmed30)} · çıkan: ${n(s.unsubscribed30)}`,
    `  Onay bekleyen: ${n(s.pending)} · 30 günlük onay oranı: ${pct(s.confirmRate30, 0)}`,
    `  Dil: ${list(s.byLang)}`,
    `  İlk geldiği yer: ${list(s.bySource)}`,
    `  İstenen içerik: ${list(s.byMagnet)}`,
    '',
    'KULLANIM',
    `  Takip listesi olan hesap: ${n(v.withWatchlist)} (hesapların ${pct(a.total ? v.withWatchlist / a.total : null)}'i)`,
    `  E-posta özetini açan hesap: ${n(v.digestOptIn)}`,
    '',
    'Bu postada olmayanlar: gelir ve MRR (Stripe panosu), ziyaret ve kaynak (GA4, Vercel Web Analytics).',
    'Rakamlar Supabase\'deki profiles, subscribers, stripe_events, watchlists ve notification_prefs tablolarından sayılır; adres içermez.',
  ];
  return {
    subject: `Fundocap rakamlar ${m.asOf}: ${n(p.active)} Pro · ${n(a.total)} hesap · ${n(s.confirmed)} abone`,
    text: lines.join('\n'),
  };
}
