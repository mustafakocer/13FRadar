import { useEffect } from 'react';

const DEFAULT = '13F Radar — Track the Smart Money';

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title || DEFAULT;
    return () => {
      document.title = DEFAULT;
    };
  }, [title]);
}
