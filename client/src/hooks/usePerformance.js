import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

// Weekly precomputed fund performance (client/public/performance.json).
export function usePerformance() {
  return useQuery({ queryKey: ['performance'], queryFn: () => api.performance(), staleTime: Infinity, retry: 0 });
}
