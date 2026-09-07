import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../auth.jsx';

const SIX_HOURS = 6 * 60 * 60 * 1000;

// Superinvestor ("Usta Yatırımcılar") data.
//   public  — /consensus.json (static CDN file written daily by the Action):
//             managers + most-held.
//   pro     — /api/consensus (402 for free users): buys, sells, new positions.
// The two are merged so consumers keep reading one object; the pro lists are
// simply absent for free users.
export function useConsensusStatic() {
  const { isPro } = useAuth();

  const pub = useQuery({
    queryKey: ['consensus'],
    queryFn: async () => {
      const r = await fetch('/consensus.json');
      if (!r.ok) throw new Error('no-consensus');
      return r.json();
    },
    staleTime: SIX_HOURS,
    retry: 1,
  });

  const pro = useQuery({
    queryKey: ['consensus-pro'],
    queryFn: api.consensus,
    enabled: isPro,
    staleTime: SIX_HOURS,
    retry: 0,
  });

  const data = useMemo(
    () => (pub.data ? { ...pub.data, ...(pro.data || {}) } : pub.data),
    [pub.data, pro.data]
  );

  return {
    data,
    isLoading: pub.isLoading,
    error: pub.error,
    proLoading: isPro && pro.isLoading,
    proError: pro.error,
  };
}
