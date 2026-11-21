import { useQuery } from '@tanstack/react-query';

// The panel behind the consensus, from consensus.json's `coverage`
// (api/_lib/gurus.js coverage()): { quarter, tracked, filed, included }.
//   tracked  — every superinvestor the site follows
//   included — those the current quarter's consensus is computed over
// A page that only states the count reads this instead of the whole
// consensus file; the server seeds it (api/_lib/ssr/routes.js), so the number
// is in the HTML and in the meta description.
export function useGuruCoverage() {
  return useQuery({
    queryKey: ['guru-coverage'],
    queryFn: async () => {
      const r = await fetch('/consensus.json');
      if (!r.ok) return null;
      return (await r.json())?.coverage ?? null;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  }).data;
}
