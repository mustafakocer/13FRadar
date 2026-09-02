import { createClient } from '@supabase/supabase-js';

// Public (publishable) credentials — safe to ship in the client bundle.
// Filled in when the Supabase project is provisioned; env vars override.
const FALLBACK_URL = 'https://rmisfrxsnhdpcxqzmicy.supabase.co';
const FALLBACK_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtaXNmcnhzbmhkcGN4cXptaWN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDE2NzQsImV4cCI6MjEwMzkxNzY3NH0.61AzY7NluBE0vhGKagzq42U6ZlGIt1M328JtqqfR56A';

const url = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON;

export const supabaseConfigured = Boolean(url && anonKey);
export const supabase = supabaseConfigured ? createClient(url, anonKey) : null;
