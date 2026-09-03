import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { flagOn } from '../lib/flags.js';

// Add / remove a stock (by CUSIP) on the user's stock watchlist.
export default function StockWatchButton({ cusip, ticker, name, compact = false }) {
  const { t } = useI18n();
  const { user, configured } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['watchlist-stocks'], queryFn: () => api.watchlistStocks.list(), enabled: !!user, retry: false, staleTime: 5 * 60 * 1000 });
  const on = !!list.data?.items?.some((s) => s.cusip === cusip);
  const mut = useMutation({
    mutationFn: () => (on ? api.watchlistStocks.remove(cusip) : api.watchlistStocks.add(cusip, ticker, name)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist-stocks'] }),
  });
  if (!flagOn('watchlists') || !configured || !cusip) return null;
  if (!user) return <Link to="/account" className="btn ghost" title={t('alerts.signInToFollow')}>☆ {!compact && t('watchlist.addStock')}</Link>;
  const limitHit = mut.error?.status === 402;
  return (
    <span className="alert-bell-wrap">
      <button className={`btn ghost${on ? ' alert-bell on' : ''}`} onClick={() => mut.mutate()} disabled={mut.isPending || list.isLoading} aria-pressed={on}>
        {on ? '⭐' : '☆'} {!compact && (on ? t('watchlist.inList') : t('watchlist.addStock'))}
      </button>
      {limitHit && (
        <span className="muted small">{t('watchlist.limit', { n: mut.error?.limit ?? '' })} <Link to="/pricing">{t('paywall.cta')}</Link></span>
      )}
    </span>
  );
}
