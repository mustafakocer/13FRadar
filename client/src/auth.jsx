import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabase, supabaseConfigured } from './lib/supabase.js';
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
    const supabase = await getSupabase();
    try {
      // The database decides what Pro means (public.is_pro: plan = 'pro' and
      // no expiry or one still ahead). The client only paints the badge and
      // the locks; every Pro payload is gated again on the server.
      const { data } = await supabase.rpc('is_pro');
      setPlan(data === true ? 'pro' : 'free');
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
    let sub = null;
    let cancelled = false;
    getSupabase().then((supabase) => {
      if (cancelled || !supabase) return;
      supabase.auth.getSession().then(({ data }) => loadProfile(data.session));
      sub = supabase.auth.onAuthStateChange((_e, session) => loadProfile(session)).data;
    });
    return () => {
      cancelled = true;
      sub?.subscription.unsubscribe();
    };
  }, [loadProfile]);

  // every auth action loads the SDK first (no-op once cached)
  const withSb = (fn) => async (...args) => fn(await getSupabase(), ...args);

  const signInEmail = useCallback(
    withSb((supabase, email) =>
      supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin + '/account' },
      })
    ),
    []
  );

  const signInPassword = useCallback(
    withSb((supabase, email, password) => supabase.auth.signInWithPassword({ email, password })),
    []
  );

  const signUpPassword = useCallback(
    withSb((supabase, email, password) =>
      supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + '/account' },
      })
    ),
    []
  );

  const resetPassword = useCallback(
    withSb((supabase, email) =>
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/account',
      })
    ),
    []
  );

  const updatePassword = useCallback(
    withSb((supabase, password) => supabase.auth.updateUser({ password })),
    []
  );

  const signOut = useCallback(
    withSb((supabase) => supabase.auth.signOut()),
    []
  );

  // Re-read the plan (after returning from Stripe Checkout).
  const refreshPlan = useCallback(async () => {
    const supabase = await getSupabase();
    const { data } = await supabase.auth.getSession();
    await loadProfile(data.session);
  }, [loadProfile]);

  const value = {
    configured: supabaseConfigured,
    user,
    plan,
    // paywall disabled until auth infra is live
    isPro: !supabaseConfigured || plan === 'pro',
    loading,
    signInEmail,
    signInPassword,
    signUpPassword,
    resetPassword,
    updatePassword,
    signOut,
    refreshPlan,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
