import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listingLookup } from '../lib/newListings.js';

// id (CUSIP or ticker) → first trading day of a recently listed security
// (client/public/new-listings.json; client/src/lib/newListings.js), or null.
export function useListedOn() {
  const file = useQuery({
    queryKey: ['new-listings'],
    queryFn: async () => {
      const r = await fetch('/new-listings.json');
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  }).data;
  return useMemo(() => (file ? listingLookup(file) : null), [file]);
}
