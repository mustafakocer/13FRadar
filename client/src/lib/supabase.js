import { createClient } from '@supabase/supabase-js';

// Public (publishable) credentials — safe to ship in the client bundle.
// Filled in when the Supabase project is provisioned; env vars override.
const FALLBACK_URL = '';
const FALLBACK_ANON = '';

const url = import.meta.env.VITE_SUPABASE_URL || FALLBACK_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON;

export const supabaseConfigured = Boolean(url && anonKey);
export const supabase = supabaseConfigured ? createClient(url, anonKey) : null;
