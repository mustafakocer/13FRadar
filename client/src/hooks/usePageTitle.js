import { useEffect } from 'react';

const DEFAULT = '13F Radar — Akıllı Para Takibi';

export function usePageTitle(title) {
  useEffect(() => {
    document.title = title || DEFAULT;
    return () => {
      document.title = DEFAULT;
    };
  }, [title]);
}
