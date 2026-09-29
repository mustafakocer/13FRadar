import { useQuery } from '@tanstack/react-query';

// client/public/universe-summary.json: funds tracked, the latest quarter's
// total and how it is defined. Seeded by the server on the pages that show it.
export function useUniverseSummary() {
  return useQuery({
    queryKey: ['universe-summary'],
    queryFn: async () => {
      const r = await fetch('/universe-summary.json');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  }).data;
}
