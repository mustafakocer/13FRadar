import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, deltaClass, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import FavoriteButton from '../components/FavoriteButton.jsx';
import PositionCards from '../components/PositionCards.jsx';
import HoldingsTable from '../components/HoldingsTable.jsx';
import AumLineChart from '../components/Charts/AumLineChart.jsx';
import FlowBarChart from '../components/Charts/FlowBarChart.jsx';
import PortfolioPie from '../components/Charts/PortfolioPie.jsx';
import SparkBar from '../components/Charts/SparkBar.jsx';

function Loading({ t }) {
  return (
    <div className="loading">
      <div className="spinner" />
      {t('common.loading')}
    </div>
  );
}

export default function Manager() {
  const { cik } = useParams();
  const { t } = useI18n();
  const [tab, setTab] = useState('overview');
  const [selAcc, setSelAcc] = useState(null);

  const mgr = useQuery({ queryKey: ['manager', cik], queryFn: () => api.manager(cik) });

  const filings = mgr.data?.filings || [];
  const acc = selAcc || filings[0]?.acc;
  const filing = filings.find((f) => f.acc === acc);
  const prevFiling = filings[filings.findIndex((f) => f.acc === acc) + 1];

  const holdings = useQuery({
    queryKey: ['holdings', cik, acc],
    queryFn: () => api.holdings(cik, acc, { fd: filing.filingDate, rd: filing.reportDate }),
    enabled: !!acc,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const prevHoldings = useQuery({
    queryKey: ['holdings-light', cik, prevFiling?.acc],
    queryFn: () =>
      api.holdings(cik, prevFiling.acc, { fd: prevFiling.filingDate, light: '1' }),
    enabled: !!prevFiling,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const aumHist = useQuery({
    queryKey: ['aum', cik],
    queryFn: () => api.aumHistory(cik),
    staleTime: 6 * 60 * 60 * 1000,
  });

  const topTickers = useMemo(
    () =>
      (holdings.data?.positions || [])
        .slice(0, 50)
        .map((p) => p.ticker)
        .filter(Boolean),
    [holdings.data]
  );

  const returns = useQuery({
    queryKey: ['returns', topTickers.join(',')],
    queryFn: () => api.returns(topTickers),
    enabled: topTickers.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  if (mgr.isLoading) return <Loading t={t} />;
  if (mgr.error) return <div className="error-box">{t('common.error')}: {String(mgr.error.message)}</div>;

  const positions = holdings.data?.positions || [];
  const history = aumHist.data?.history || [];
  const latest = history[history.length - 1];

  // 1D return, weighted by portfolio weight over resolved tickers
  let day1 = null;
  if (returns.data && positions.length) {
    let wSum = 0;
    let acc1d = 0;
    for (const p of positions.slice(0, 50)) {
      const r = returns.data[p.ticker];
      if (r?.ret1d != null) {
        wSum += p.weight;
        acc1d += p.weight * r.ret1d;
      }
    }
    if (wSum > 10) day1 = acc1d / wSum;
  }

  const top10 = positions.slice(0, 10).reduce((s, p) => s + p.weight, 0);

  const badges = [
    day1 != null && { label: t('manager.day1'), v: day1, fmt: (x) => fmtPct(x, { digits: 2 }) },
    latest?.qoq != null && { label: t('manager.qoq'), v: latest.qoq, fmt: fmtPct },
    latest?.yoy != null && { label: t('manager.yoy'), v: latest.yoy, fmt: fmtPct },
    latest?.estFlow != null && { label: t('manager.estFlow'), v: latest.estFlow, fmt: fmtMoney },
  ].filter(Boolean);

  return (
    <div>
      <div className="page-head">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <FavoriteButton cik={mgr.data.cik} name={mgr.data.name} />
          <div>
            <h1>{mgr.data.name}</h1>
            <div className="sub">
              CIK {mgr.data.cik}
              {mgr.data.city ? ` · ${mgr.data.city}, ${mgr.data.state}` : ''}
              {filing ? ` · ${t('manager.quarterEnd')}: ${filing.reportDate} · ${t('manager.filedOn')}: ${filing.filingDate}` : ''}
            </div>
            <div className="head-badges">
              {badges.map((b) => (
                <span key={b.label} className={`badge ${b.v >= 0 ? 'pos' : 'neg'}`}>
                  {b.label} {b.fmt(b.v)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <select className="select" value={acc || ''} onChange={(e) => setSelAcc(e.target.value)}>
          {filings.map((f) => (
            <option key={f.acc} value={f.acc}>
              {quarterLabel(f.reportDate)} {f.form === '13F-HR/A' ? '(A)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="tabs">
        {['overview', 'portfolio', 'holdings'].map((k) => (
          <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {t(`manager.${k}`)}
          </button>
        ))}
      </div>

      {holdings.isLoading && <Loading t={t} />}
      {holdings.error && (
        <div className="error-box">{t('common.error')}: {String(holdings.error.message)}</div>
      )}

      {!holdings.isLoading && !holdings.error && tab === 'overview' && (
        <>
          <div className="grid grid-3">
            <div className="card stat-card">
              <span className="stat-label">{t('manager.aum')}</span>
              <span className="stat-value">{fmtMoney(holdings.data?.aum)}</span>
              <SparkBar values={history.map((h) => h.aum)} />
            </div>
            <div className="card stat-card">
              <span className="stat-label">{t('manager.positions')}</span>
              <span className="stat-value">{fmtNum(holdings.data?.count)}</span>
              <SparkBar values={history.map((h) => h.positions)} color="--s2" />
            </div>
            <div className="card stat-card">
              <span className="stat-label">{t('manager.top10')}</span>
              <span className="stat-value">{fmtPct(top10, { sign: false })}</span>
              <span className="stat-sub">
                {latest?.estFlow != null && (
                  <>
                    {t('manager.estFlow')}:{' '}
                    <b className={deltaClass(latest.estFlow)}>{fmtMoney(latest.estFlow)}</b>
                  </>
                )}
              </span>
            </div>
          </div>

          <div className="card mt16">
            <h3>{t('manager.aumHistory')}</h3>
            {aumHist.isLoading ? <Loading t={t} /> : history.length > 1 ? (
              <AumLineChart history={history} />
            ) : (
              <div className="muted small">{t('common.na')}</div>
            )}
          </div>

          {history.some((h) => h.estFlow != null) && (
            <div className="card mt16">
              <h3>{t('manager.flowHistory')}</h3>
              <FlowBarChart history={history} label={t('manager.estFlow')} />
              <p className="muted small mt8">{t('manager.flowNote')}</p>
            </div>
          )}
        </>
      )}

      {!holdings.isLoading && !holdings.error && tab === 'portfolio' && (
        <>
          <PositionCards
            positions={positions}
            prevPositions={prevHoldings.data?.positions || null}
          />
          <div className="card mt16">
            <h3>{t('manager.composition')}</h3>
            <PortfolioPie positions={positions} />
          </div>
        </>
      )}

      {!holdings.isLoading && !holdings.error && tab === 'holdings' && (
        <HoldingsTable
          positions={positions}
          returns={returns.data}
          exportName={`13F_${mgr.data.cik}_${filing?.reportDate || ''}.xlsx`}
        />
      )}
    </div>
  );
}
