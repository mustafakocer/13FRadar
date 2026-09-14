import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { getSeenFiling } from '../hooks/useSeenFilings.js';
import { quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { managerPath } from '../lib/paths.js';
import Ico from '../components/Ico.jsx';
import { Star, Bell } from 'lucide-react';

export default function Watchlist() {
  const { t, lang } = useI18n();
  const { favorites, toggleFavorite } = useFavorites();
  useSeo(useMemo(() => ({ title: `${t('watchlist.title')} — Fundocap`, path: '/watchlist', noindex: true }), [t, lang]));

  // check each favorite's latest filing for a NEW badge
  const infos = useQueries({
    queries: favorites.map((f) => ({
      queryKey: ['manager', f.cik],
      queryFn: () => api.manager(f.cik),
      staleTime: 30 * 60 * 1000,
    })),
  });

  return (
    <div>
      <div className="page-head">
        <h1><Ico icon={Star} size={22} /> {t('watchlist.title')}</h1>
      </div>
      {!favorites.length && <div className="card muted">{t('watchlist.empty')}</div>}
      {favorites.map((f, i) => {
        const latest = infos[i]?.data?.filings?.[0];
        const seen = getSeenFiling(f.cik);
        const isNew = latest && seen && latest.filingDate > seen;
        return (
          <div className="card row" key={f.cik} style={{ justifyContent: 'space-between', marginTop: 10 }}>
            <div className="row">
              <Link to={managerPath(f.cik)} style={{ fontWeight: 700, fontSize: 16 }}>
                {f.name}
              </Link>
              {isNew && <span className="badge info"><Ico icon={Bell} size={14} /> {t('watchlist.newFiling')}</span>}
              {latest && (
                <span className="muted small">
                  {quarterLabel(latest.reportDate)} · {latest.filingDate}
                </span>
              )}
            </div>
            <div className="row">
              <span className="muted small">CIK {f.cik}</span>
              <button className="btn ghost" onClick={() => toggleFavorite(f)}>
                {t('watchlist.remove')}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
