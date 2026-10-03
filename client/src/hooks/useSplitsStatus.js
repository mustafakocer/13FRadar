import { useQuery } from '@tanstack/react-query';

// client/public/splits-status.json: the day the stock-split table last
// changed (scripts/build-splits.mjs). Seeded by the server on every page.
export function useSplitsStatus() {
  return useQuery({
    queryKey: ['splits-status'],
    queryFn: async () => {
      const r = await fetch('/splits-status.json');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  }).data;
}
