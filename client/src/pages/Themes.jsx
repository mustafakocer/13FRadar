import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import SecurityHolders, { ValueHistory } from '../components/SecurityHolders.jsx';

export default function Themes() {
  const { t, lang } = useI18n();
  usePageTitle(`${t('themes.title')} — 13F Radar`);
  const q = useQuery({ queryKey: ['themes'], queryFn: () => api.themes(), staleTime: 30 * 60 * 1000, retry: 0 });
  const themes = q.data?.themes || [];
  const [sel, setSel] = useState(null);
  const theme = themes.find((x) => x.id === sel) || themes[0];
  const name = (th) => (lang === 'tr' ? th.name : th.nameEn || th.name);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🧭 {t('themes.title')}</h1>
          <div className="sub">{t('themes.subtitle')}</div>
        </div>
      </div>
      {q.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {(q.error || (q.data && !themes.length)) && <div className="card muted">{t('themes.noData')}</div>}
      {themes.length > 0 && (
        <div className="tabs">
          {themes.map((th) => (
            <button key={th.id} className={`tab${theme?.id === th.id ? ' active' : ''}`} onClick={() => setSel(th.id)}>{th.icon} {name(th)}</button>
          ))}
        </div>
      )}
      {theme && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>{theme.icon} {name(theme)}</h3>
              <span className="muted small">{quarterLabel(theme.period)}</span>
            </div>
            <div className="head-badges mt8">
              <span className="badge plain">{t('themes.distinctFunds')}: <b>{fmtNum(theme.funds)}</b></span>
              <span className="badge plain">{t('turkiye.value')}: <b>{fmtMoney(theme.value)}</b></span>
              <span className="badge pos">{t('turkiye.adding')} {theme.adding}</span>
              <span className="badge neg">{t('turkiye.reducing')} {theme.reducing}</span>
              <span className={`badge ${theme.netFlow > 0 ? 'pos' : theme.netFlow < 0 ? 'neg' : 'plain'}`}>{t('turkiye.netFlow')}: {(theme.netFlow > 0 ? '+' : '') + fmtMoney(theme.netFlow)}</span>
              <span className="badge plain">{theme.securities.length} ETF</span>
            </div>
            {theme.history?.length > 1 && (
              <div className="mt16">
                <div className="stat-label" style={{ marginBottom: 6 }}>{t('themes.history')}</div>
                <ValueHistory history={theme.history} height={200} />
              </div>
            )}
          </div>
          {theme.securities.map((s) => <SecurityHolders key={s.cusip} s={s} />)}
          <p className="muted small mt16">{t('themes.note')}</p>
        </>
      )}
    </div>
  );
}
