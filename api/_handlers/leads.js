import fs from 'node:fs';
import path from 'node:path';
import { authConfigured, hasServiceKey, svcSelect, svcInsert, svcUpdate, noStore } from '../_lib/auth.js';
import {
  parseMagnet, normalizeEmail, newToken, confirmAllowed, mergeRequest, signGrant, verifyGrant,
  mailConfigured, sendMail, confirmMail, deliveryMail, unsubscribeUrl, unsubscribeHeaders,
} from '../_lib/leads.js';
import { metaConfigured, sendMetaEvent, browserContext, cleanEventId } from '../_lib/metaCapi.js';
import { readRawBody } from '../_lib/stripe.js';
import { siteUrl } from '../_lib/site.js';
import { consensusCsv, insiderBuysCsv } from '../_lib/leadFiles.js';

// The lead-magnet endpoints (api/_lib/leads.js has the rules):
//   POST /api/subscribe            { email, magnet, lang, newsletter, website(honeypot), mc, eid, fbp, fbc, url }
//   GET  /api/subscribe-confirm?t= the link in the confirmation mail → /{lang}/thanks?g=<grant>&m=<magnets>
//   GET  /api/unsubscribe?t=       → /{lang}/unsubscribe?t= (a page with a button: link scanners must not unsubscribe anyone)
//   POST /api/unsubscribe?t=       the button, and mail clients' one-click (List-Unsubscribe-Post)
//   GET  /api/lead-file?f=&g=      a downloadable magnet behind a grant
//
// Answers never say whether an address is already on the list.
const CONSENT_TEXT = {
  tr: 'E-posta adresimin seçtiğim içeriği göndermek için kullanılmasını onaylıyorum; bülteni seçtiysem haftalık bülten de gönderilir. Her e-postadaki bağlantıyla istediğim an çıkabilirim.',
  en: 'I agree to my email being used to send the content I chose, and the weekly newsletter if I ticked it. I can leave at any time from the link in every email.',
};

const ready = () => authConfigured() && hasServiceKey() && mailConfigured();
const langOf = (v) => (v === 'en' ? 'en' : 'tr');
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  try {
    return JSON.parse((await readRawBody(req)) || '{}');
  } catch {
    return {};
  }
}

const findBy = async (field, value) => (await svcSelect('subscribers', { select: '*', [field]: `eq.${value}`, limit: 1 }))[0] || null;

// The links a delivery mail and the thanks page hand over.
export function magnetLinks(site, lang, magnets, grant) {
  const out = {};
  for (const m of magnets) {
    if (m.kind === 'report') out[m.id] = `${site}/api/lead-file?f=${encodeURIComponent(m.id)}&l=${lang}&g=${grant}`;
    else if (m.kind === 'xl-consensus' || m.kind === 'xl-insiders') out[m.id] = `${site}/api/lead-file?f=${m.kind}&g=${grant}`;
    else if (m.kind === 'match') out[m.id] = `${site}/${lang}/match?g=${grant}`;
  }
  return out;
}

async function deliver(row, site) {
  const lang = langOf(row.lang);
  const magnets = (row.magnets || []).map(parseMagnet).filter(Boolean);
  const grant = signGrant();
  const links = grant ? magnetLinks(site, lang, magnets, grant) : {};
  const unsub = unsubscribeUrl(site, row.unsub_token);
  const mail = deliveryMail({ lang, magnets, links, unsub, site });
  await sendMail({ to: row.email, ...mail, headers: unsubscribeHeaders(site, row.unsub_token) });
  return grant;
}

export async function subscribe(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const b = await body(req);
  // bots fill every field; people never see this one
  if (b.website) return res.status(200).json({ ok: true });
  const email = normalizeEmail(b.email);
  if (!email) return res.status(400).json({ error: 'bad-email' });
  const magnet = parseMagnet(b.magnet);
  if (!magnet) return res.status(400).json({ error: 'bad-magnet' });
  if (!ready()) return res.status(503).json({ error: 'not-configured' });
  const lang = langOf(b.lang);
  const site = siteUrl(req);
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;

  try {
    let row = await findBy('email', email);
    const merged = mergeRequest(row, { magnet, newsletter: Boolean(b.newsletter) });

    // Meta Lead (server copy), only with marketing consent from the banner
    const lead = b.mc === '1' && metaConfigured() && cleanEventId(b.eid)
      ? sendMetaEvent({ name: 'Lead', id: cleanEventId(b.eid), email, country: String(req.headers['x-vercel-ip-country'] || ''), ...browserContext(req, b), custom: { content_name: magnet.kind } })
      : null;

    if (row && row.status === 'confirmed') {
      // already confirmed: no new consent needed for what they asked; mail it
      const gate = confirmAllowed(row);
      if (!gate.ok) return res.status(200).json({ ok: true, status: 'sent' });
      await svcUpdate('subscribers', { id: `eq.${row.id}` }, { ...merged, lang, confirm_sent_at: new Date().toISOString(), confirm_sends: gate.sends });
      await deliver({ ...row, ...merged, lang, magnets: [magnet.id] }, site);
      if (lead) await lead;
      return res.status(200).json({ ok: true, status: 'sent' });
    }

    const gate = confirmAllowed(row);
    if (!gate.ok) return res.status(200).json({ ok: true, status: 'pending' });
    const token = newToken();
    const fields = {
      ...merged,
      lang,
      source: row?.source || magnet.kind,
      status: 'pending',
      confirm_token: token,
      confirm_sent_at: new Date().toISOString(),
      confirm_sends: gate.sends,
      consent_text: CONSENT_TEXT[lang],
      consent_ip: ip,
    };
    if (row) {
      if (row.status === 'unsubscribed') {
        // a fresh request after leaving starts from the new ask only
        Object.assign(fields, { newsletter: Boolean(b.newsletter) || magnet.kind === 'newsletter', gurus: magnet.kind === 'guru' ? [magnet.cik] : [], magnets: [magnet.id] });
      }
      await svcUpdate('subscribers', { id: `eq.${row.id}` }, fields);
    } else {
      row = await svcInsert('subscribers', { email, unsub_token: newToken(), ...fields });
    }
    const confirmUrl = `${site}/api/subscribe-confirm?t=${token}`;
    await sendMail({ to: email, ...confirmMail({ lang, magnet, newsletter: fields.newsletter, confirmUrl, site }) });
    if (lead) await lead;
    return res.status(200).json({ ok: true, status: 'pending' });
  } catch (err) {
    console.error(`subscribe failed: ${String(err.message || err)}`);
    return res.status(502).json({ error: 'subscribe-failed' });
  }
}

export async function confirm(req, res) {
  noStore(res);
  const t = String(req.query.t || '');
  const fail = (lang = 'tr') => res.writeHead(302, { Location: `/${lang}/thanks?e=expired` }).end();
  if (!TOKEN_RE.test(t) || !authConfigured() || !hasServiceKey()) return fail();
  try {
    const row = await findBy('confirm_token', t);
    if (!row) return fail();
    const now = new Date().toISOString();
    await svcUpdate('subscribers', { id: `eq.${row.id}` }, { status: 'confirmed', confirm_token: null, confirmed_at: now, consent_at: now, unsubscribed_at: null });
    const site = siteUrl(req);
    let grant = null;
    try {
      grant = await deliver({ ...row, status: 'confirmed' }, site);
    } catch (e) {
      console.error(`welcome mail failed: ${String(e.message || e)}`);
      grant = signGrant();
    }
    const lang = langOf(row.lang);
    const qs = new URLSearchParams({ m: (row.magnets || []).join(','), ...(grant ? { g: grant } : {}) });
    return res.writeHead(302, { Location: `/${lang}/thanks?${qs}` }).end();
  } catch (err) {
    console.error(`confirm failed: ${String(err.message || err)}`);
    return fail();
  }
}

export async function unsubscribe(req, res) {
  noStore(res);
  const t = String(req.query.t || '');
  if (!TOKEN_RE.test(t)) return res.status(400).json({ error: 'bad-token' });
  if (req.method === 'GET') {
    let lang = 'tr';
    try {
      lang = langOf((await findBy('unsub_token', t))?.lang);
    } catch {
      /* the page works in either language */
    }
    return res.writeHead(302, { Location: `/${lang}/unsubscribe?t=${encodeURIComponent(t)}` }).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
  if (!authConfigured() || !hasServiceKey()) return res.status(503).json({ error: 'not-configured' });
  try {
    const row = await findBy('unsub_token', t);
    if (row && row.status !== 'unsubscribed') {
      await svcUpdate('subscribers', { id: `eq.${row.id}` }, { status: 'unsubscribed', newsletter: false, gurus: [], confirm_token: null, unsubscribed_at: new Date().toISOString() });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`unsubscribe failed: ${String(err.message || err)}`);
    return res.status(502).json({ error: 'unsubscribe-failed' });
  }
}

const REPORT_DIR = path.join(process.cwd(), 'api', '_data', 'reports');

export async function leadFile(req, res) {
  noStore(res);
  if (!verifyGrant(req.query.g)) return res.status(403).json({ error: 'expired' });
  const f = String(req.query.f || '').toLowerCase();
  const m = parseMagnet(f);
  try {
    if (m?.kind === 'report') {
      const lang = req.query.l === 'en' ? 'en' : 'tr';
      // the reader's language first, then the other one (scripts/build-report-pdf.mjs writes both)
      const file = [`${m.report}.${lang}.pdf`, `${m.report}.${lang === 'en' ? 'tr' : 'en'}.pdf`].map((f) => path.join(REPORT_DIR, f)).find((f) => fs.existsSync(f));
      if (!file) return res.writeHead(302, { Location: `/${lang}/reports/${m.report}` }).end();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="fundocap-13f-${m.report}.pdf"`);
      return res.status(200).send(fs.readFileSync(file));
    }
    if (m?.kind === 'xl-consensus' || m?.kind === 'xl-insiders') {
      const { name, csv } = m.kind === 'xl-consensus' ? consensusCsv() : insiderBuysCsv();
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      // the BOM makes Excel read the file as UTF-8 (Turkish characters, ₺)
      return res.status(200).send(`﻿${csv}`);
    }
    return res.status(400).json({ error: 'unknown-file' });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
}
