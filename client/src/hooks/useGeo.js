import { useQuery } from '@tanstack/react-query';

export function useGeo() {
  return useQuery({
    queryKey: ['geo'],
    queryFn: async () => {
      const r = await fetch('/api/geo');
      if (!r.ok) return { country: '' };
      return r.json();
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });
}
