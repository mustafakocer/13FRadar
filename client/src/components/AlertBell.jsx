import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { flagOn } from '../lib/flags.js';

// Follow a fund (kind='fund', key=CIK) or a stock (kind='stock', key=CUSIP)
// for email alerts. Signed-out users are sent to the account page.
export default function AlertBell({ kind, alertKey, label, compact = false }) {
  const { t } = useI18n();
  const { user, configured } = useAuth();
  const qc = useQueryClient();
  const subs = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api.alerts.list(),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const key = kind === 'fund' ? String(alertKey).padStart(10, '0') : String(alertKey).toUpperCase();
  const on = !!subs.data?.items?.some((s) => s.kind === kind && s.key === key);
  const mut = useMutation({
    mutationFn: () => (on ? api.alerts.remove(kind, key) : api.alerts.add(kind, key, label)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
  if (!flagOn('alerts') || !configured) return null;
  if (!user) {
    return (
      <Link to="/account" className="btn ghost alert-bell" title={t('alerts.signInToFollow')}>
        🔔 {!compact && t('alerts.follow')}
      </Link>
    );
  }
  const limitHit = mut.error?.status === 402;
  return (
    <span className="alert-bell-wrap">
      <button
        className={`btn ghost alert-bell${on ? ' on' : ''}`}
        onClick={() => mut.mutate()}
        disabled={mut.isPending || subs.isLoading}
        aria-pressed={on}
        title={on ? t('alerts.unfollow') : t('alerts.follow')}
      >
        {on ? '🔔' : '🔕'} {!compact && (on ? t('alerts.following') : t('alerts.follow'))}
      </button>
      {limitHit && (
        <span className="muted small">
          {t('alerts.limit', { n: mut.error?.limit ?? '' })} <Link to="/pricing">{t('paywall.cta')}</Link>
        </span>
      )}
      {mut.error && !limitHit && <span className="muted small">{String(mut.error.message)}</span>}
    </span>
  );
}
