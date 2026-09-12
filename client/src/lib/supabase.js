// Public (publishable) credentials — safe to ship in the client bundle.
// Filled in when the Supabase project is provisioned; env vars override.
const FALLBACK_URL = 'https://rmisfrxsnhdpcxqzmicy.supabase.co';
const FALLBACK_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtaXNmcnhzbmhkcGN4cXptaWN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDE2NzQsImV4cCI6MjEwMzkxNzY3NH0.61AzY7NluBE0vhGKagzq42U6ZlGIt1M328JtqqfR56A';

const url = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON;

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
