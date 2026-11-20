import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;

// The whole ranked table of securities the curated funds hold. Pages that
// list and filter — the ownership rankings, the screener — read this rather
// than the thirty rows the public consensus file carries.
//
// Filtering happens on the server so the sector list the page offers is the
// one the table can actually honour.
//
// `standIn` is an answer the caller already holds for exactly this question
// (a ranking page's server seed: the same response, cut to the rows that
// page lists). While there is one, and the table itself is not in cache, the
// table is not fetched.
export function useGuruStocks({ limit = 500, sector, cap, minHolders, strongBuy, standIn = null } = {}) {
  const q = useQuery({
    queryKey: ['guru-stocks', limit, sector || '', cap || '', minHolders || 0, strongBuy ? 1 : 0],
    queryFn: () => api.guruStocks({ limit, sector, cap, minHolders, strongBuy }),
    enabled: !standIn,
    staleTime: SIX_HOURS,
    retry: 1,
  });

  const data = q.data ?? standIn ?? undefined;
  const ready = data?.available === true;
  return {
    ...q,
    data,
    isLoading: q.isLoading && !data,
    ready,
    stocks: ready ? data.stocks || [] : [],
    sectors: ready ? data.sectors || [] : [],
    matched: data?.matched ?? 0,
    universe: data?.universe ?? null,
    reportDate: data?.reportDate ?? null,
    managers: data?.managers ?? 0,
    coverage: data?.coverage ?? null,
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
