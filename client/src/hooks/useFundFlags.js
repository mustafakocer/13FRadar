import { useQuery } from '@tanstack/react-query';

// client/public/fund-flags.json: the funds whose current SEC filing does not
// add up (api/_lib/fundFlags.js), written each night with the universe.
// → (cik) => { acc, kind, declared, table } | null
const pad = (cik) => String(cik || '').replace(/\D/g, '').padStart(10, '0');

export function useFundFlags() {
  const data = useQuery({
    queryKey: ['fund-flags'],
    queryFn: async () => {
      const r = await fetch('/fund-flags.json');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: 24 * 60 * 60 * 1000,
    retry: 0,
  }).data;
  return (cik) => data?.byCik?.[pad(cik)] || null;
}
