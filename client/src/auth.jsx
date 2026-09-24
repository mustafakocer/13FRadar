import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSupabase, supabaseConfigured } from './lib/supabase.js';
import { setAuthToken } from './lib/api.js';
import { mergeFavorites, addFavorite } from './hooks/useFavorites.js';
import { consumePendingFavorite } from './lib/pendingFavorite.js';
import { authReturnUrl } from './lib/authRedirect.js';

const AuthCtx = createContext(null);

// Until Supabase is provisioned (supabaseConfigured=false) everything stays
// open: user=null, isPro=true. Flipping the config activates the paywall.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [plan, setPlan] = useState('free');
  // the own profile row (RLS: select own): plan_expires and the Stripe ids
  // decide what the account page offers
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(supabaseConfigured);

  const loadProfile = useCallback(async (session) => {
    setUser(session?.user ?? null);
    setAuthToken(session?.access_token ?? null);
    if (!session?.user) {
      setPlan('free');
      setProfile(null);
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
    try {
      const { data: row } = await supabase
        .from('profiles')
        .select('plan,plan_expires,stripe_customer_id,stripe_subscription_id')
        .eq('id', session.user.id)
        .maybeSingle();
      setProfile(row || null);
    } catch {
      setProfile(null);
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
    // the fund starred before signing in lands on the list now
    const pending = consumePendingFavorite();
    if (pending) addFavorite({ cik: pending.cik, name: pending.name });
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

  // Every round trip that leaves the site (email link, OAuth) comes back to
  // /account with the page that asked in ?next= (lib/authRedirect.js).
  const signInEmail = useCallback(
    withSb((supabase, email, next = null) =>
      supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: authReturnUrl(window.location.origin, next) },
      })
    ),
    []
  );

  // Google through Supabase (Authentication → Providers → Google). The
  // browser leaves for Google and comes back to the redirect URL, which
  // must be on the project's allow-list. Supabase links a Google identity
  // whose (verified) address matches an existing email account to that
  // account rather than creating a second user.
  const signInGoogle = useCallback(
    withSb((supabase, next = null) =>
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: authReturnUrl(window.location.origin, next), queryParams: { prompt: 'select_account' } },
      })
    ),
    []
  );

  const signInPassword = useCallback(
    withSb((supabase, email, password) => supabase.auth.signInWithPassword({ email, password })),
    []
  );

  const signUpPassword = useCallback(
    withSb((supabase, email, password, next = null) =>
      supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: authReturnUrl(window.location.origin, next) },
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
    profile,
    // Pro is a plan, never a side effect of missing configuration: the API
    // answers 402 to an anonymous caller either way, so the client must not
    // draw the Pro view when the SDK is simply not configured.
    isPro: plan === 'pro',
    loading,
    signInEmail,
    signInGoogle,
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
