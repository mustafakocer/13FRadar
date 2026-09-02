import { authConfigured, setUserPlan } from '../_lib/auth.js';

// Lemon Squeezy subscription webhook.
// Configure the webhook URL as: https://<site>/api/ls-webhook?secret=<LS_WEBHOOK_SECRET>
// Events handled: subscription_created / subscription_updated / subscription_expired.
// The checkout must pass checkout[custom][user_id] (the Pricing page does).
const ACTIVE_STATUSES = new Set(['active', 'on_trial', 'past_due', 'cancelled']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const secret = process.env.LS_WEBHOOK_SECRET;
  if (!secret || req.query.secret !== secret) {
    return res.status(401).json({ error: 'Bad secret' });
  }
  if (!authConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Auth not configured' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const event = body?.meta?.event_name;
    const userId = body?.meta?.custom_data?.user_id;
    const attrs = body?.data?.attributes || {};
    if (!userId) return res.status(200).json({ ok: true, skipped: 'no user_id' });

    if (String(event).startsWith('subscription_')) {
      const status = attrs.status;
      if (ACTIVE_STATUSES.has(status)) {
        // 'cancelled' keeps access until ends_at
        const expires = attrs.ends_at || attrs.renews_at || null;
        await setUserPlan(userId, 'pro', expires);
      } else {
        await setUserPlan(userId, 'free', null);
      }
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
}
