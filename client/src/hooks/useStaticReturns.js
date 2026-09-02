import { useQuery } from '@tanstack/react-query';

// 1Y/YTD/1D returns precomputed daily by the consensus GitHub Action and
// served as a static CDN file — instant, no per-symbol API calls.
export function useStaticReturns() {
  return useQuery({
    queryKey: ['static-returns'],
    queryFn: async () => {
      const r = await fetch('/returns.json');
      if (!r.ok) return {};
      const d = await r.json();
      return d.returns || {};
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });
}
