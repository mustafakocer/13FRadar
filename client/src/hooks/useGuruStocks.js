import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;

// The whole ranked table of securities the curated funds hold. Pages that
// list and filter — the ownership rankings, the screener — read this rather
// than the thirty rows the public consensus file carries.
//
// Filtering happens on the server so the sector list the page offers is the
// one the table can actually honour.
export function useGuruStocks({ limit = 500, sector, cap, minHolders, strongBuy } = {}) {
  const q = useQuery({
    queryKey: ['guru-stocks', limit, sector || '', cap || '', minHolders || 0, strongBuy ? 1 : 0],
    queryFn: () => api.guruStocks({ limit, sector, cap, minHolders, strongBuy }),
    staleTime: SIX_HOURS,
    retry: 1,
  });

  const ready = q.data?.available === true;
  return {
    ...q,
    ready,
    stocks: ready ? q.data.stocks || [] : [],
    sectors: ready ? q.data.sectors || [] : [],
    matched: q.data?.matched ?? 0,
    universe: q.data?.universe ?? null,
    reportDate: q.data?.reportDate ?? null,
    managers: q.data?.managers ?? 0,
  };
}

export function useGuruOptions() {
  const q = useQuery({
    queryKey: ['guru-options'],
    queryFn: api.guruOptions,
    staleTime: SIX_HOURS,
    retry: 1,
  });
  return { ...q, ready: q.data?.available === true, options: q.data?.options || [] };
}
