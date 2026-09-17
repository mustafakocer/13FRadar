import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabase.js';

// Saved alerts and the email preference, read and written straight through
// Supabase. Row-level security already restricts every row to its owner, so
// there is nothing for a server handler to add here beyond a hop.
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

export function useAlerts() {
  const [alerts, setAlerts] = useState([]);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const s = await session();
    if (!s) {
      setAlerts([]);
      setLoading(false);
      return;
    }
    const [{ data: rows }, { data: prefs }] = await Promise.all([
      s.supabase.from('alerts').select('*').order('created_at', { ascending: false }),
      s.supabase.from('notification_prefs').select('email_enabled').maybeSingle(),
    ]);
    setAlerts(rows || []);
    // no preference row means the schema default, which is on
    setEmailEnabled(prefs ? prefs.email_enabled : true);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveAlert = useCallback(
    async ({ kind, label, params }) => {
      const s = await session();
      if (!s) return null;
      const { data } = await s.supabase
        .from('alerts')
        .insert({ user_id: s.userId, kind, label, params })
        .select()
        .maybeSingle();
      await refresh();
      return data;
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

  const setEmail = useCallback(
    async (on) => {
      setEmailEnabled(on); // optimistic: the switch should not lag the click
      const s = await session();
      if (!s) return;
      await s.supabase
        .from('notification_prefs')
        .upsert({ user_id: s.userId, email_enabled: on, updated_at: new Date().toISOString() });
    },
    []
  );

  return { alerts, emailEnabled, loading, saveAlert, removeAlert, setEmail, refresh };
}
