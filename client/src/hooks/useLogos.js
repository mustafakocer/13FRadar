import { useQuery } from '@tanstack/react-query';

// Two small manifests the weekly job writes, each fetched once per session
// and read as an empty map when absent or unreadable — every caller then
// falls back to the two-letter badge.
async function manifest(file, key) {
  try {
    const r = await fetch(`/${file}`);
    if (!r.ok) return {};
    const j = await r.json();
    return j?.[key] && typeof j[key] === 'object' ? j[key] : {};
  } catch {
    return {};
  }
}
const opts = { staleTime: Infinity, gcTime: Infinity, retry: 0 };

// ticker → self-hosted logo file (client/public/logos.json, scripts/build-logos.mjs)
export function useLogos() {
  const q = useQuery({ queryKey: ['logos'], queryFn: () => manifest('logos.json', 'logos'), ...opts });
  return q.data || {};
}

// ticker → company web domain (client/public/domains.json, scripts/build-domains.mjs)
export function useDomains() {
  const q = useQuery({ queryKey: ['domains'], queryFn: () => manifest('domains.json', 'domains'), ...opts });
  return q.data || {};
}
