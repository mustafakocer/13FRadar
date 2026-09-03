// Alert sender (P0-3). Runs from .github/workflows/alerts.yml every 2 hours.
//
//   node scripts/send-alerts.mjs            (ALERTS_DRY_RUN=1 to only log)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, ALERTS_FROM,
//      SITE_URL, SEC_USER_AGENT, ALERTS_MAX_AGE_DAYS (default 30)
//
// Flow: load subscriptions (service role) -> for each followed fund read its
// latest 13F (original + amendments => event id) -> plan deliveries that were
// never sent (unique per user/kind/key/event) -> claim row (pending) -> send
// via Resend -> mark sent/failed. Filings older than ALERTS_MAX_AGE_DAYS are
// recorded as 'skipped' so a fresh subscription does not email stale history.
// Stock subscriptions are evaluated against the filings of every followed
// fund plus the curated superinvestor list (scanning all ~8k filers per run
// would exceed EDGAR's rate budget).
import axios from 'axios';
import { getSubmissions, list13F, getFilingHoldings } from '../api/_lib/sec.js';
import { mapLimit } from '../api/_lib/yahooClient.js';
import { CONSENSUS_MANAGERS } from '../api/_lib/consensusList.js';
import { eventId, diffFilings, pendingDeliveries, renderFundEmail, renderStockEmail } from '../api/_lib/alerts.js';
import { sendEmail, resendConfigured } from '../api/_lib/resend.js';
import { restHeaders, restUrl, hasServiceRole } from '../api/_lib/auth.js';
import { mapCusipsToTickers } from '../api/_lib/figi.js';

const DRY = process.env.ALERTS_DRY_RUN === '1';
const SITE = (process.env.SITE_URL || 'https://13-f-radar-omega.vercel.app').replace(/\/$/, '');
const MAX_AGE_DAYS = Number(process.env.ALERTS_MAX_AGE_DAYS || 30);
const H = () => restHeaders('service');

async function rest(method, table, { params, data, prefer } = {}) {
  const r = await axios({
    method,
    url: restUrl(table),
    params,
    data,
    headers: { ...H(), ...(prefer ? { Prefer: prefer } : {}) },
    timeout: 15000,
    validateStatus: () => true,
  });
  if (r.status >= 300) throw new Error(`${method} ${table} -> ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  return r.data;
}

const daysAgo = (d) => (Date.now() - new Date(d).getTime()) / 86400000;

async function main() {
  if (!hasServiceRole()) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  if (!DRY && !resendConfigured()) throw new Error('RESEND_API_KEY missing (set ALERTS_DRY_RUN=1 to test)');

  const subs = await rest('get', 'alert_subscriptions', { params: { select: 'user_id,kind,key,label' } });
  if (!subs.length) return console.log('No subscriptions.');
  const profiles = await rest('get', 'profiles', { params: { select: 'id,email', id: `in.(${[...new Set(subs.map((s) => s.user_id))].join(',')})` } });
  const emailOf = new Map(profiles.map((p) => [p.id, p.email]));

  const fundKeys = new Set(subs.filter((s) => s.kind === 'fund').map((s) => s.key));
  const stockKeys = new Set(subs.filter((s) => s.kind === 'stock').map((s) => s.key));
  const scan = new Set(fundKeys);
  if (stockKeys.size) for (const m of CONSENSUS_MANAGERS) scan.add(m.cik);
  console.log(`subs=${subs.length} funds=${fundKeys.size} stocks=${stockKeys.size} scan=${scan.size}`);

  // latest filing per fund
  const funds = (
    await mapLimit([...scan], 3, async (cik) => {
      try {
        const sub = await getSubmissions(cik);
        const fl = list13F(sub);
        if (!fl.length) return null;
        return { cik, name: sub.name, latest: fl[0], prev: fl[1] || null, event: eventId(fl[0]) };
      } catch (e) {
        console.warn(`skip ${cik}: ${e.message}`);
        return null;
      }
    })
  ).filter(Boolean);

  const fundEvents = funds.filter((f) => fundKeys.has(f.cik)).map((f) => ({ kind: 'fund', key: f.cik, eventId: f.event }));
  const delivered = await rest('get', 'alert_deliveries', {
    params: { select: 'user_id,kind,key,event_id,status,attempts', created_at: `gte.${new Date(Date.now() - 180 * 86400000).toISOString()}` },
  });

  // stock events need holdings diffs; compute lazily per fund and cache
  const diffCache = new Map();
  async function diffFor(f) {
    if (diffCache.has(f.cik)) return diffCache.get(f.cik);
    const cur = await getFilingHoldings(f.cik, f.latest);
    let prev = null;
    if (f.prev) {
      try {
        prev = await getFilingHoldings(f.cik, f.prev);
      } catch {}
    }
    const d = { cur, prev, diff: diffFilings(prev ? prev.positions : null, cur.positions) };
    diffCache.set(f.cik, d);
    return d;
  }

  const stockEvents = [];
  const stockChange = new Map(); // `${cusip}|${cik}` -> change
  if (stockKeys.size) {
    for (const f of funds) {
      if (daysAgo(f.latest.filingDate) > MAX_AGE_DAYS) continue; // stale filing: nothing to notify
      const { diff } = await diffFor(f);
      for (const k of ['NEW', 'ADD', 'REDUCE', 'EXIT']) {
        for (const c of diff[k]) {
          if (!stockKeys.has(c.cusip)) continue;
          stockEvents.push({ kind: 'stock', key: c.cusip, eventId: `${f.cik}:${f.event}` });
          stockChange.set(`${c.cusip}|${f.cik}`, { change: c, fund: f });
        }
      }
    }
  }

  const pending = pendingDeliveries(subs, [...fundEvents, ...stockEvents], delivered);
  console.log(`pending deliveries: ${pending.length}`);
  const fundByCik = new Map(funds.map((f) => [f.cik, f]));
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const p of pending) {
    const to = emailOf.get(p.user_id);
    const fund = p.kind === 'fund' ? fundByCik.get(p.key) : fundByCik.get(p.event_id.split(':')[0]);
    if (!fund) continue;
    const stale = daysAgo(fund.latest.filingDate) > MAX_AGE_DAYS;
    const row = { user_id: p.user_id, kind: p.kind, key: p.key, event_id: p.event_id, attempts: p.attempts + 1 };
    if (!to || stale) {
      skipped++;
      if (!DRY) await rest('post', 'alert_deliveries', { data: { ...row, status: 'skipped', error: !to ? 'no email' : 'stale filing' }, prefer: 'resolution=merge-duplicates' });
      continue;
    }
    try {
      let msg;
      if (p.kind === 'fund') {
        const { cur, diff } = await diffFor(fund);
        const tickers = await mapCusipsToTickers([...diff.NEW, ...diff.ADD, ...diff.REDUCE, ...diff.EXIT].slice(0, 40).map((c) => c.cusip)).catch(() => ({}));
        for (const k of ['NEW', 'ADD', 'REDUCE', 'EXIT']) for (const c of diff[k]) c.ticker = c.ticker || tickers[c.cusip] || null;
        msg = renderFundEmail({ fundName: fund.name, cik: fund.cik, reportDate: fund.latest.reportDate, filingDate: fund.latest.filingDate, aum: cur.aum, positions: cur.positions.length, diff, siteUrl: SITE });
      } else {
        const hit = stockChange.get(`${p.key}|${fund.cik}`);
        if (!hit) continue;
        const tickers = await mapCusipsToTickers([p.key]).catch(() => ({}));
        msg = renderStockEmail({ ticker: hit.change.ticker || tickers[p.key] || null, issuer: hit.change.issuer, cusip: p.key, fundName: fund.name, cik: fund.cik, reportDate: fund.latest.reportDate, filingDate: fund.latest.filingDate, change: hit.change, siteUrl: SITE });
      }
      if (DRY) {
        console.log(`[dry] -> ${to}: ${msg.subject}`);
        sent++;
        continue;
      }
      // claim first so a crash mid-send cannot produce a duplicate next run
      await rest('post', 'alert_deliveries', { data: { ...row, status: 'pending' }, prefer: 'resolution=merge-duplicates' });
      await sendEmail({ to, ...msg });
      await rest('patch', 'alert_deliveries', { params: { user_id: `eq.${p.user_id}`, kind: `eq.${p.kind}`, key: `eq.${p.key}`, event_id: `eq.${p.event_id}` }, data: { status: 'sent', sent_at: new Date().toISOString(), error: null } });
      sent++;
    } catch (e) {
      failed++;
      console.warn(`failed ${p.kind}/${p.key} for ${p.user_id}: ${e.message}`);
      if (!DRY) await rest('post', 'alert_deliveries', { data: { ...row, status: 'failed', error: String(e.message).slice(0, 300) }, prefer: 'resolution=merge-duplicates' }).catch(() => {});
    }
  }
  console.log(`done: sent=${sent} failed=${failed} skipped=${skipped}`);
  if (failed && !sent) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
