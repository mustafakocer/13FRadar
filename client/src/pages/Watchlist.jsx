import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useAlerts } from '../hooks/useAlerts.js';
import { getSeenFiling } from '../hooks/useSeenFilings.js';
import { quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useSeo } from '../seo.jsx';
import { managerPath } from '../lib/paths.js';
import { activeGurus } from '../data/popular.js';
import GoogleButton from '../components/GoogleButton.jsx';
import Ico from '../components/Ico.jsx';
import { Star, Bell, BellRing, Plus } from 'lucide-react';

// Five well-known funds to start a list with: the first discretionary
// names of the registry, minus what is already on the list.
const SUGGESTED = 5;
const suggestions = (favorites) =>
  activeGurus()
    .filter((g) => g.consensus !== false && !favorites.some((f) => f.cik === g.cik))
    .slice(0, SUGGESTED);

function SignedOut({ t, favorites }) {
  return (
    <div className="card" style={{ maxWidth: 560, margin: '0 auto' }} data-watchlist="signed-out">
      <h3><Ico icon={Star} /> {t('watchlist.signInTitle')}</h3>
      <p className="muted small">{t('watchlist.signInSub')}</p>
      <ul className="about-text" style={{ margin: '8px 0 14px 18px', padding: 0 }}>
        <li>{t('watchlist.v1')}</li>
        <li>{t('watchlist.v2')}</li>
        <li>{t('watchlist.v3')}</li>
      </ul>
      <div style={{ display: 'grid', gap: 8 }}>
        <GoogleButton next="/watchlist" />
        <Link to={`/account?next=${encodeURIComponent('/watchlist')}`} className="btn ghost" style={{ textDecoration: 'none', textAlign: 'center' }}>
          {t('login.email')}
        </Link>
      </div>
      {favorites.length > 0 && <p className="muted small mt16">{t('watchlist.localNote').replace('{n}', favorites.length)}</p>}
    </div>
  );
}

export default function Watchlist() {
  const { t, lang } = useI18n();
  const { favorites, toggleFavorite, addFavorite, error, clearError } = useFavorites();
  const { configured, user } = useAuth();
  const { alerts, enableFilingAlerts, loading: alertsLoading } = useAlerts();
  const [busy, setBusy] = useState(null);
  useSeo(useMemo(() => ({ title: `${t('watchlist.title')} — Fundocap`, path: '/watchlist', noindex: true }), [t, lang]));

  // check each favorite's latest filing for a NEW badge
  const infos = useQueries({
    queries: favorites.map((f) => ({
      queryKey: ['manager', f.cik],
      queryFn: () => api.manager(f.cik),
      staleTime: 30 * 60 * 1000,
    })),
  });
  const signedOut = configured && !user;
  const alerted = new Set(alerts.filter((a) => a.kind === 'filing').map((a) => a.target));
  const pad = (cik) => String(cik).padStart(10, '0');
  const enable = async (f) => {
    setBusy(f.cik);
    await enableFilingAlerts([f]);
    setBusy(null);
  };
  const picks = suggestions(favorites);

  return (
    <div>
      <div className="page-head">
        <h1><Ico icon={Star} size={22} /> {t('watchlist.title')}</h1>
      </div>
      {signedOut && <SignedOut t={t} favorites={favorites} />}
      {error && (
        <div className="notice warn small" style={{ marginBottom: 12 }}>
          {t('watchlist.syncFailed')} <button className="linklike" onClick={clearError}>{t('common.close')}</button>
        </div>
      )}
      {!favorites.length && !signedOut && <div className="card muted">{t('watchlist.empty')}</div>}
      {favorites.map((f, i) => {
        const latest = infos[i]?.data?.filings?.[0];
        const seen = getSeenFiling(f.cik);
        const isNew = latest && seen && latest.filingDate > seen;
        const hasAlert = alerted.has(pad(f.cik));
        return (
          <div className="card row" key={f.cik} style={{ justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap' }} data-watch-row>
            <div className="row" style={{ minWidth: 0 }}>
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
              {user && !alertsLoading && (
                hasAlert ? (
                  <span className="badge plain sm" title={t('alerts.title')}><Ico icon={BellRing} size={12} /> {t('watchlist.alertOn')}</span>
                ) : (
                  <button className="chip sm" disabled={busy != null} onClick={() => enable(f)} data-watch="alert">
                    {busy === f.cik ? '…' : <><Ico icon={Bell} size={12} /> {t('watchlist.alertEnable')}</>}
                  </button>
                )
              )}
              <button className="btn ghost sm" onClick={() => toggleFavorite(f)}>
                {t('watchlist.remove')}
              </button>
            </div>
          </div>
        );
      })}
      {!signedOut && picks.length > 0 && (
        <div className="card mt16" data-watchlist="suggested">
          <b>{favorites.length ? t('watchlist.suggestedMore') : t('watchlist.suggested')}</b>
          <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap' }}>
            {picks.map((g) => (
              <button key={g.cik} className="chip" onClick={() => addFavorite({ cik: g.cik, name: g.name })}>
                <Ico icon={Plus} size={14} /> {g.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
