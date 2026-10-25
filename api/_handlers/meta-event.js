import { getUser, noStore } from '../_lib/auth.js';
import { metaConfigured, sendMetaEvent, browserContext } from '../_lib/metaCapi.js';

// POST /api/meta-event?event=registration&fbp=&fbc=&url=  (bearer token required)
// The Conversions API copy of CompleteRegistration. The client calls it once,
// right after a new account's first sign-in, and only for a visitor who
// accepted marketing cookies (client/src/lib/metaPixel.js). The event is
// bound to the signed-in user, so it cannot be sent for anyone else: id
// reg_<user id> (the browser's fbq() uses the same, Meta keeps one), and only
// while the account is under a day old, so an old account never counts as a
// new sign-up. Only this one event is accepted.
const NEW_ACCOUNT_MS = 24 * 3600 * 1000;

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (req.query.event !== 'registration') return res.status(400).json({ error: 'unknown-event' });
  if (!metaConfigured()) return res.status(200).json({ ok: false, skipped: 'not-configured' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'sign-in-required' });
  const created = Date.parse(user.createdAt || '');
  if (!Number.isFinite(created) || Date.now() - created > NEW_ACCOUNT_MS) {
    return res.status(200).json({ ok: false, skipped: 'not-new' });
  }
  const country = String(req.headers['x-vercel-ip-country'] || '').toUpperCase();
  const r = await sendMetaEvent({
    name: 'CompleteRegistration',
    id: `reg_${user.id}`,
    email: user.email,
    externalId: user.id,
    country,
    ...browserContext(req, req.query),
    custom: { status: 'registered' },
  });
  res.status(200).json(r);
}
