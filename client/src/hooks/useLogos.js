import { useQuery } from '@tanstack/react-query';

// The ticker → logo-file manifest the nightly job writes
// (client/public/logos.json, scripts/build-logos.mjs). Absent file or a run
// that disabled itself both come back as an empty map: every caller falls
// back to the two-letter badge. Fetched once per session.
export function useLogos() {
  const q = useQuery({
    queryKey: ['logos'],
    queryFn: async () => {
      try {
        const r = await fetch('/logos.json');
        if (!r.ok) return {};
        const j = await r.json();
        return j?.logos && typeof j.logos === 'object' ? j.logos : {};
      } catch {
        return {};
      }
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });
  return q.data || {};
}
