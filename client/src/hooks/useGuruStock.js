import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;

// One security's standing among the curated funds: rank, holder count, this
// quarter's activity and the holders themselves (trimmed for free callers).
//
// The endpoint answers for every name the panel holds, not only the thirty
// that fit on the consensus page, so this is what a stock page should ask
// before falling back to the static most-held list.
export function useGuruStock({ ticker, cusip }) {
  const q = useQuery({
    queryKey: ['guru-stock', cusip || ticker],
    queryFn: () => api.guruStock({ ticker, cusip }),
    enabled: Boolean(ticker || cusip),
    staleTime: SIX_HOURS,
    retry: 1,
  });

  // `available: false` means the daily Action has not written the table yet —
  // the caller should fall back rather than render an empty block.
  const ready = q.data?.available === true;
  return {
    ...q,
    ready,
    held: ready && q.data.held === true,
    stock: ready ? q.data.stock : null,
    holders: ready ? q.data.holders || [] : [],
    topByConviction: ready ? q.data.topByConviction || [] : [],
    topByValue: ready ? q.data.topByValue || [] : [],
    options: ready ? q.data.options || [] : [],
    holdersTruncated: Boolean(q.data?.holdersTruncated),
    universe: q.data?.universe ?? null,
    reportDate: q.data?.reportDate ?? null,
  };
}
