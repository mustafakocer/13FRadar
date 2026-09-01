import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase, supabaseConfigured } from './lib/supabase.js';
import { setAuthToken } from './lib/api.js';
import { mergeFavorites } from './hooks/useFavorites.js';

const AuthCtx = createContext(null);

// Until Supabase is provisioned (supabaseConfigured=false) everything stays
// open: user=null, isPro=true. Flipping the config activates the paywall.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [plan, setPlan] = useState('free');
  const [loading, setLoading] = useState(supabaseConfigured);

  const loadProfile = useCallback(async (session) => {
    setUser(session?.user ?? null);
    setAuthToken(session?.access_token ?? null);
    if (!session?.user) {
      setPlan('free');
      setLoading(false);
      return;
    }
    try {
      const { data } = await supabase
        .from('profiles')
        .select('plan, plan_expires')
        .eq('id', session.user.id)
        .maybeSingle();
      const active =
        data?.plan === 'pro' &&
        (!data.plan_expires || new Date(data.plan_expires) > new Date());
      setPlan(active ? 'pro' : 'free');
    } catch {
      setPlan('free');
    }
    setLoading(false);

    // two-way watchlist sync (best effort)
    try {
      const { data: rows } = await supabase.from('watchlists').select('cik,name');
      const merged = mergeFavorites(rows || []);
      await supabase
        .from('watchlists')
        .upsert(merged.map((f) => ({ user_id: session.user.id, cik: f.cik, name: f.name })));
    } catch {
      /* sync is optional */
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      loadProfile(session)
    );
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signInEmail = useCallback(
    (email) =>
      supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + '/account' },
      }),
    []
  );

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  const value = {
    configured: supabaseConfigured,
    user,
    plan,
    // paywall disabled until auth infra is live
    isPro: !supabaseConfigured || plan === 'pro',
    loading,
    signInEmail,
    signOut,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
