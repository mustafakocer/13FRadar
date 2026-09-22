import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabase.js';

// Saved alerts and the email digest preference, read and written straight
// through Supabase (migrations/0004_alerts). Row-level security restricts
// every row to its owner, so there is nothing for a server handler to add
// here beyond a hop.
//
//   notification_prefs  { user_id, email_digest, digest_frequency }
//   alerts              { id, kind: 'filing'|'insider', target, label, filters }
//
// Everything degrades to "no alerts" when auth is not configured or nobody is
// signed in: the pages that use this render the rest of themselves either way.
async function session() {
  const supabase = await getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  return user ? { supabase, userId: user.id } : null;
}

const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');

// The message a failed write should show: the plan cap (the database says
// 'alert limit: …' with hint alert-cap), or the raw error.
export function alertError(error) {
  if (!error) return null;
  const msg = String(error.message || error);
  if (/alert limit|alert-cap/i.test(msg)) return { code: 'cap', message: msg };
  return { code: 'error', message: msg };
}

export function useAlerts() {
  const [alerts, setAlerts] = useState([]);
  // the value in the database; false until it has been read (opt-in)
  const [emailDigest, setEmailDigest] = useState(false);
  const [frequency, setFrequency] = useState('weekly');
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const s = await session();
    if (!s) {
      setAlerts([]);
      setLoading(false);
      return;
    }
    const [rows, prefs] = await Promise.all([
      s.supabase.from('alerts').select('id,kind,target,label,filters,last_fired_at,created_at').order('created_at', { ascending: false }),
      s.supabase.from('notification_prefs').select('email_digest,digest_frequency').eq('user_id', s.userId).maybeSingle(),
    ]);
    if (rows.error) setError(alertError(rows.error));
    setAlerts(rows.data || []);
    // the row exists for every account (signup trigger + backfill); a missing
    // row means opt-in not yet given, which is the same as false
    setEmailDigest(Boolean(prefs.data?.email_digest));
    setFrequency(prefs.data?.digest_frequency || 'weekly');
    setPrefsLoaded(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // One alert per (kind, target): saving the same one twice updates the
  // label and filters rather than adding a row.
  const saveAlert = useCallback(
    async ({ kind, target, label = null, filters = {} }) => {
      const s = await session();
      if (!s) return { ok: false, error: { code: 'signed-out' } };
      const row = { user_id: s.userId, kind, target: kind === 'filing' ? pad(target) : String(target || '*').toUpperCase(), label, filters };
      const { data, error: err } = await s.supabase.from('alerts').upsert(row, { onConflict: 'user_id,kind,target' }).select().maybeSingle();
      const e = alertError(err);
      setError(e);
      await refresh();
      return { ok: !e, data, error: e };
    },
    [refresh]
  );

  // Filing alerts for several funds in one statement (the cap is judged on
  // the total, so either all of them land or none).
  const enableFilingAlerts = useCallback(
    async (funds) => {
      const s = await session();
      if (!s) return { ok: false, error: { code: 'signed-out' } };
      const rows = funds.map((f) => ({ user_id: s.userId, kind: 'filing', target: pad(f.cik), label: f.name || null, filters: {} }));
      if (!rows.length) return { ok: true };
      const { error: err } = await s.supabase.from('alerts').upsert(rows, { onConflict: 'user_id,kind,target' });
      const e = alertError(err);
      setError(e);
      await refresh();
      return { ok: !e, error: e };
    },
    [refresh]
  );

  const removeAlert = useCallback(
    async (id) => {
      const s = await session();
      if (!s) return;
      await s.supabase.from('alerts').delete().eq('id', id);
      await refresh();
    },
    [refresh]
  );

  // The switch reflects the database: optimistic while the write is in
  // flight, then whatever the row says (a failed write snaps it back).
  const setPrefs = useCallback(
    async ({ email_digest = emailDigest, digest_frequency = frequency } = {}) => {
      setEmailDigest(email_digest);
      setFrequency(digest_frequency);
      const s = await session();
      if (!s) return;
      const { error: err } = await s.supabase
        .from('notification_prefs')
        .upsert({ user_id: s.userId, email_digest, digest_frequency }, { onConflict: 'user_id' });
      if (err) setError(alertError(err));
      const { data } = await s.supabase.from('notification_prefs').select('email_digest,digest_frequency').eq('user_id', s.userId).maybeSingle();
      if (data) {
        setEmailDigest(Boolean(data.email_digest));
        setFrequency(data.digest_frequency || 'weekly');
      }
    },
    [emailDigest, frequency]
  );

  const setEmail = useCallback((on) => setPrefs({ email_digest: on }), [setPrefs]);

  return { alerts, emailDigest, frequency, prefsLoaded, loading, error, saveAlert, enableFilingAlerts, removeAlert, setEmail, setPrefs, refresh };
}
