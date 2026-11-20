import { useQuery } from '@tanstack/react-query';
import { covers } from '../lib/accessedSeed.js';

const KEEP = { staleTime: Infinity, gcTime: Infinity, retry: 0 };

// 1Y/YTD/1D returns precomputed daily by the consensus GitHub Action and
// served as a static CDN file — instant, no per-symbol API calls.
//
// The file is 4,000 symbols (~300 KB). A server-rendered page carries only
// the symbols it shows, under ['static-returns-seed'] (entry-server.jsx,
// lib/accessedSeed.js). Pass the symbols the page is showing now as
// `needed`: while the seed answers for all of them the file is not fetched;
// the first symbol it has no answer for (a sort, a filter, a search, another
// page) fetches the whole file once. Called with no list, or on a page the
// server did not seed, it fetches the file as before.
export function useStaticReturns(needed) {
  // never fetched: it exists only as the server's seed
  const seed = useQuery({ queryKey: ['static-returns-seed'], queryFn: () => null, enabled: false, ...KEEP });
  const partial = covers(seed.data, needed);
  const full = useQuery({
    queryKey: ['static-returns'],
    queryFn: async () => {
      const r = await fetch('/returns.json');
      if (!r.ok) return {};
      const d = await r.json();
      return d.returns || {};
    },
    enabled: !partial,
    ...KEEP,
  });
  // the whole file once it is here; until then whatever the seed knows
  return { ...full, data: full.data ?? seed.data ?? undefined };
}
