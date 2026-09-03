import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { flagOn } from '../lib/flags.js';

// Account page section: the user's alert subscriptions.
export default function AlertSettings() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const subs = useQuery({ queryKey: ['alerts'], queryFn: () => api.alerts.list(), retry: false });
  const remove = useMutation({
    mutationFn: ({ kind, key }) => api.alerts.remove(kind, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
  if (!flagOn('alerts')) return null;
  const items = subs.data?.items || [];
  return (
    <div className="card" style={{ maxWidth: 560, margin: '16px auto 0' }}>
      <h3>🔔 {t('alerts.title')}</h3>
      <p className="muted small">{t('alerts.desc')}</p>
      {subs.isLoading && <div className="muted small">{t('common.loading')}</div>}
      {subs.error && <div className="muted small">{t('common.error')}: {String(subs.error.message)}</div>}
      {!subs.isLoading && !items.length && <div className="muted small">{t('alerts.empty')}</div>}
      {items.map((s) => (
        <div className="kv" key={`${s.kind}|${s.key}`}>
          <span className="k">
            <span className="badge plain" style={{ marginRight: 6 }}>{t(`alerts.kind.${s.kind}`)}</span>
            {s.kind === 'fund' ? (
              <Link to={`/manager/${s.key}`}>{s.label || s.key}</Link>
            ) : (
              <Link to={`/stock/${s.label || ''}?cusip=${s.key}`}>{s.label || s.key}</Link>
            )}
          </span>
          <button className="btn ghost" onClick={() => remove.mutate({ kind: s.kind, key: s.key })} disabled={remove.isPending}>
            {t('watchlist.remove')}
          </button>
        </div>
      ))}
      {subs.data?.limit != null && (
        <p className="muted small mt8">
          {t('alerts.usage', { n: items.length, limit: subs.data.limit })} <Link to="/pricing">{t('paywall.cta')}</Link>
        </p>
      )}
    </div>
  );
}
