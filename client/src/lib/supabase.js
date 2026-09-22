// Public (publishable) Supabase credentials, from the build environment only:
// VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Vercel → Environment
// Variables, then redeploy — Vite inlines them at build time). Nothing is
// baked in here; without them auth is off and the site is the free tier.
// (import.meta.env exists under Vite; node tests import this module too)
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const url = env.VITE_SUPABASE_URL || '';
const anonKey = env.VITE_SUPABASE_ANON_KEY || '';

export const supabaseConfigured = Boolean(url && anonKey);

// The SDK (~120 KB) is loaded on demand after first paint: nothing on a
// server-rendered page needs it before the user interacts or a session is
// restored. Resolves to null when auth is not configured.
let clientPromise = null;
export function getSupabase() {
  if (!supabaseConfigured || typeof window === 'undefined') return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(url, anonKey));
  }
  return clientPromise;
}
