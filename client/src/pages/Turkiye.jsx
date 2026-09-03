import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import SecurityHolders from '../components/SecurityHolders.jsx';

export default function Turkiye() {
  const { t } = useI18n();
  usePageTitle(`${t('turkiye.title')} — 13F Radar`);
  const q = useQuery({ queryKey: ['turkey'], queryFn: () => api.turkey(), staleTime: 30 * 60 * 1000, retry: 0 });
  const secs = q.data?.securities || [];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🇹🇷 {t('turkiye.title')}</h1>
          <div className="sub">{t('turkiye.subtitle')}</div>
        </div>
      </div>
      {q.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {(q.error || (q.data && !secs.length)) && <div className="card muted">{t('turkiye.noData')}</div>}
      {secs.map((s) => <SecurityHolders key={s.cusip} s={s} />)}
      {secs.length > 0 && <p className="muted small mt16">{t('turkiye.note', { list: secs.map((s) => `${s.ticker} (${s.name})`).join(', ') })}</p>}
    </div>
  );
}
