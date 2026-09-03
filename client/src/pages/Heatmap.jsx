import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { buildFlowTree } from '../../../api/_lib/flowTree.js';
import FlowTreemap from '../components/Charts/FlowTreemap.jsx';
import Paywall from '../components/Paywall.jsx';

export default function Heatmap() {
  const { t } = useI18n();
  const { isPro } = useAuth();
  usePageTitle(`${t('heat.title')} — 13F Radar`);
  const cur = useQuery({ queryKey: ['stocks-universe'], queryFn: () => api.stocksUniverse(), staleTime: Infinity, retry: 0 });
  const prev = useQuery({ queryKey: ['stocks-prev'], queryFn: () => api.stocksPrev(), staleTime: Infinity, retry: 0 });
  const [period, setPeriod] = useState('current');
  const [metric, setMetric] = useState('net');
  const periods = [
    cur.data?.period && { key: 'current', label: quarterLabel(cur.data.period), rows: cur.data.rows },
    prev.data?.period && prev.data.rows?.some((r) => r.diffFunds) && { key: 'prev', label: quarterLabel(prev.data.period), rows: prev.data.rows },
  ].filter(Boolean);
  const selected = periods.find((p) => p.key === period) || periods[0];
  const tree = useMemo(() => (selected ? buildFlowTree(selected.rows, { metric, maxPerSector: 30, minAbsFlow: 1e6 }) : null), [selected, metric]);
  const labels = { sector: (s) => t(`sector.${s}`), flow: t('screener.netFlow'), in: t('heat.in'), out: t('heat.out'), stocks: t('screener.count'), value: t('screener.value'), funds: t('screener.funds') };
  const hasData = tree && tree.children.length > 0;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🌡️ {t('heat.title')}</h1>
          <div className="sub">{t('heat.subtitle')}</div>
        </div>
      </div>
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
          {periods.length > 0 && (
            <div className="seg">
              {periods.map((p) => <button key={p.key} className={period === p.key || (!periods.some((x) => x.key === period) && p === periods[0]) ? 'active' : ''} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
            </div>
          )}
          <div className="seg">
            {['net', 'in', 'out'].map((m) => <button key={m} className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>{t(`heat.metric.${m}`)}</button>)}
          </div>
          {hasData && (
            <span className="muted small">
              {t('heat.in')} <b className="delta-pos">{fmtMoney(tree.totalIn)}</b> · {t('heat.out')} <b className="delta-neg">{fmtMoney(tree.totalOut)}</b>
            </span>
          )}
        </div>
        {!isPro && <p className="muted small mt8">{t('heat.freeNote')} <Link to="/pricing">{t('paywall.cta')}</Link></p>}
      </div>
      {cur.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {cur.data && !hasData && <div className="card muted mt16">{t('heat.noData')}</div>}
      {hasData && (
        <div className="card mt16">
          <FlowTreemap tree={tree} labels={labels} drill={isPro} />
          {!isPro && <div className="mt16"><Paywall compact /></div>}
          <p className="muted small mt8">{t('heat.note')}</p>
        </div>
      )}
      {hasData && (
        <div className="card mt16">
          <h3>{t('heat.bySector')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th className="l">{t('screener.sector')}</th><th>{t('screener.netFlow')}</th><th>{t('heat.in')}</th><th>{t('heat.out')}</th><th>{t('screener.value')}</th><th>{t('screener.count')}</th></tr></thead>
              <tbody>
                {tree.children.map((c) => (
                  <tr key={c.name}>
                    <td className="l">{t(`sector.${c.name}`)}</td>
                    <td className={`num ${c.flow > 0 ? 'delta-pos' : c.flow < 0 ? 'delta-neg' : ''}`}>{(c.flow > 0 ? '+' : '') + fmtMoney(c.flow)}</td>
                    <td className="num delta-pos">{fmtMoney(c.inflow)}</td>
                    <td className="num delta-neg">{fmtMoney(c.outflow)}</td>
                    <td className="num">{fmtMoney(c.value)}</td>
                    <td className="num">{c.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
