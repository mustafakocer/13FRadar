import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

// Daily precomputed superinvestor data (static CDN file, API fallback).
export function useConsensusStatic() {
  return useQuery({
    queryKey: ['consensus'],
    queryFn: async () => {
      try {
        const r = await fetch('/consensus.json');
        if (r.ok) {
          const d = await r.json();
          if (d?.mostHeld?.length) return d;
        }
      } catch {
        /* fall back to API */
      }
      return api.consensus();
    },
    staleTime: 6 * 60 * 60 * 1000,
    retry: 2,
  });
}
