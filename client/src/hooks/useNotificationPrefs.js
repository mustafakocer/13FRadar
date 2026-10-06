import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from '../lib/supabase.js';
import { track, EVENTS } from '../lib/analytics.js';

// The reader's email digest preference (migrations/0004 + 0006): read and
// written directly on notification_prefs under RLS — the row is the
// reader's own. The signup trigger makes the row; a reader from before it
// existed gets one on the first save (upsert).
//
// { prefs, loading, error, save({ email_digest, digest_frequency, lang }) }
export function useNotificationPrefs(user, lang) {
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(Boolean(user));
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!user) {
      setPrefs(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    (async () => {
      const supabase = await getSupabase();
      if (!supabase || !alive) return;
      const { data, error: e } = await supabase.from('notification_prefs').select('email_digest,digest_frequency,lang').eq('user_id', user.id).maybeSingle();
      if (!alive) return;
      if (e) setError(e.message);
      setPrefs(data || { email_digest: false, digest_frequency: 'weekly', lang });
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [user, lang]);

  const save = useCallback(
    async (patch) => {
      if (!user) return false;
      const before = prefs;
      const next = { ...(prefs || { email_digest: false, digest_frequency: 'weekly' }), lang, ...patch };
      setPrefs(next);
      setError(null);
      const supabase = await getSupabase();
      if (!supabase) return false;
      const { error: e } = await supabase.from('notification_prefs').upsert({ user_id: user.id, ...next }, { onConflict: 'user_id' });
      if (e) {
        setPrefs(before);
        setError(e.message);
        return false;
      }
      if (patch.email_digest != null && patch.email_digest !== before?.email_digest) track(patch.email_digest ? EVENTS.digestOn : EVENTS.digestOff);
      return true;
    },
    [user, prefs, lang]
  );

  return { prefs, loading, error, save };
}
