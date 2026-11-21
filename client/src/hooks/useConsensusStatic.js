import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../auth.jsx';
import { consensusLite } from '../lib/consensusLite.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;

// Superinvestor ("Usta Yatırımcılar") data.
//   public  — /consensus.json (static CDN file written daily by the Action):
//             managers + most-held.
//   pro     — /api/consensus (402 for free users): buys, sells, new positions.
// The two are merged so consumers keep reading one object; the pro lists are
// simply absent for free users.
//
// `full` is for the one page that reads `updates` (the consensus page's fund
// tab). Everyone else gets the file without it (lib/consensusLite.js): that
// is what the server seeds, so a stock page's HTML does not carry a hundred
// fund cards it never shows. A page that already has the whole file in cache
// uses it rather than fetching again.
const fetchConsensus = async () => {
  const r = await fetch('/consensus.json');
  if (!r.ok) throw new Error('no-consensus');
  return r.json();
};

export function useConsensusStatic({ full = false } = {}) {
  const { isPro } = useAuth();

  const whole = useQuery({
    queryKey: ['consensus'],
    queryFn: fetchConsensus,
    enabled: full,
    staleTime: SIX_HOURS,
    retry: 1,
  });
  const lite = useQuery({
    queryKey: ['consensus-lite'],
    queryFn: async () => consensusLite(await fetchConsensus()),
    enabled: !full && !whole.data,
    staleTime: SIX_HOURS,
    retry: 1,
  });
  // the whole file when it is here; the lighter one stands in meanwhile
  const pub = {
    data: whole.data ?? lite.data,
    isLoading: (full ? whole.isLoading : lite.isLoading) && !(whole.data ?? lite.data),
    error: full ? whole.error : whole.data ? null : lite.error,
  };

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
