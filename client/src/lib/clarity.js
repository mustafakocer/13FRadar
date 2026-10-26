// Microsoft Clarity (heatmaps and session recordings), loaded only after the
// visitor accepted the cookie banner (lib/consent.js) and only in a build
// with VITE_CLARITY_ID. Clarity masks form inputs by default; keep the
// project's masking on "Balanced" or "Strict" in its settings.
import { marketingAllowed, onConsentChange } from './consent.js';

export const CLARITY_ID = String(import.meta.env?.VITE_CLARITY_ID || '').trim();
export const clarityConfigured = () => /^[a-z0-9]{6,20}$/i.test(CLARITY_ID);
const inBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

let loaded = false;
export function loadClarity() {
  if (loaded || !inBrowser() || !clarityConfigured() || !marketingAllowed()) return;
  loaded = true;
  // Microsoft's base code, unminified: queue calls until the tag lands
  window.clarity =
    window.clarity ||
    function clarity() {
      (window.clarity.q = window.clarity.q || []).push(arguments);
    };
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.clarity.ms/tag/${encodeURIComponent(CLARITY_ID)}`;
  document.head.appendChild(s);
  window.clarity('consent');
}

// Withdrawn consent: tell Clarity, which stops and clears its cookies.
onConsentChange((state) => {
  if (state === 'granted') return loadClarity();
  if (!inBrowser() || !clarityConfigured()) return;
  if (window.clarity) window.clarity('consent', false);
  const host = window.location.hostname.replace(/^www\./, '');
  for (const c of ['_clck', '_clsk']) {
    document.cookie = `${c}=; Max-Age=0; path=/`;
    document.cookie = `${c}=; Max-Age=0; path=/; domain=.${host}`;
  }
});
