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
import HoldingsTreemap from '../components/Charts/HoldingsTreemap.jsx';
import SectorPie from '../components/Charts/SectorPie.jsx';
import BenchmarkBars from '../components/Charts/BenchmarkBars.jsx';
import SparkBar from '../components/Charts/SparkBar.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { markFilingSeen } from '../hooks/useSeenFilings.js';
import { Link } from 'react-router-dom';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import { SkeletonRows, SkeletonStats } from '../components/Skeleton.jsx';
import { managerStyle } from '../data/popular.js';
import { cashLikeSummary, effectivePositions } from '../lib/cashLike.js';
import AlertBell from '../components/AlertBell.jsx';
import { usePerformance } from '../hooks/usePerformance.js';
import { flagOn } from '../lib/flags.js';
import ChangeStory from '../components/ChangeStory.jsx';
import InfoTip from '../components/InfoTip.jsx';

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

  // returns come from the precomputed static file — zero per-symbol calls
  const returns = useStaticReturns();
  const benchReturns = returns;

  const sectorTickers = topTickers.slice(0, 25);
  const sectors = useQuery({
    queryKey: ['sectors', sectorTickers.join(',')],
    queryFn: () => api.sectors(sectorTickers),
    enabled: tab === 'portfolio' && sectorTickers.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
  });

  usePageTitle(mgr.data?.name ? `${mgr.data.name} — 13F Radar` : null);

  // mark the latest filing as "seen" for watchlist NEW badges
  if (mgr.data && filings[0]) markFilingSeen(mgr.data.cik, filings[0].filingDate);

  const perf = usePerformance();
  const perfRow = flagOn('performance') ? perf.data?.funds?.find((f) => f.cik === String(cik).padStart(10, '0')) : null;

  const mstats = useQuery({
    queryKey: ['mstats', cik],
    queryFn: () => api.managerStats(cik),
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
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
  const effN = effectivePositions(positions);
  const cash = cashLikeSummary(positions);
  const trades = mstats.data?.latest || null;
  const signedMoney = (v) => (v > 0 ? '+' : '') + fmtMoney(v);

  // Current-portfolio weighted 1Y/YTD return over resolved top-50 tickers
  let port1y = null;
  let portYtd = null;
  if (returns.data && positions.length) {
    let w1 = 0, a1 = 0, w2 = 0, a2 = 0;
    for (const p of positions.slice(0, 50)) {
      const r = returns.data[p.ticker];
      if (r?.ret1y != null) { w1 += p.weight; a1 += p.weight * r.ret1y; }
      if (r?.retYtd != null) { w2 += p.weight; a2 += p.weight * r.retYtd; }
    }
    if (w1 > 10) port1y = a1 / w1;
    if (w2 > 10) portYtd = a2 / w2;
  }
  const benchSeries =
    port1y != null && benchReturns.data
      ? [
          { label: t('manager.portfolioSeries'), ret1y: port1y, retYtd: portYtd },
          ...['SPY', 'QQQ', 'IWM']
            .filter((s) => benchReturns.data[s])
            .map((s) => ({
              label: s,
              ret1y: benchReturns.data[s].ret1y,
              retYtd: benchReturns.data[s].retYtd,
            })),
        ]
      : null;

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
              {perfRow?.score != null && (
                <Link to="/performance" className={`badge ${perfRow.score >= 67 ? 'pos' : perfRow.score <= 33 ? 'neg' : 'plain'}`} title={t('perf.badgeTip')}>
                  🏆 {t('perf.score')} {perfRow.score}{perfRow.ret1y != null ? ` · 1Y ${fmtPct(perfRow.ret1y * 100)}` : ''}
                </Link>
              )}
              {managerStyle(mgr.data.cik) && (
                <span className="badge plain">{t(`style.${managerStyle(mgr.data.cik)}`)}</span>
              )}
              {badges.map((b) => (
                <span key={b.label} className={`badge ${b.v >= 0 ? 'pos' : 'neg'}`}>
                  {b.label} {b.fmt(b.v)}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="row">
          <AlertBell kind="fund" alertKey={mgr.data.cik} label={mgr.data.name} />
          <button className="btn ghost no-print" onClick={() => window.print()}>
            🖨 {t('manager.print')}
          </button>
          <select className="select" value={acc || ''} onChange={(e) => setSelAcc(e.target.value)}>
            {filings.map((f) => (
              <option key={f.acc} value={f.acc}>
                {quarterLabel(f.reportDate)} {f.form === '13F-HR/A' || f.amended ? '(A)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tabs">
        {['overview', 'portfolio', 'holdings'].map((k) => (
          <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {t(`manager.${k}`)}
          </button>
        ))}
      </div>

      {holdings.isLoading && (
        <>
          <SkeletonStats />
          <div className="mt16">
            <SkeletonRows rows={7} />
          </div>
        </>
      )}
      {holdings.error && (
        <div className="error-box">{t('common.error')}: {String(holdings.error.message)}</div>
      )}

      {!holdings.isLoading && !holdings.error && tab === 'overview' && (
        <>
          <div className="grid grid-4">
            <div className="card stat-card">
              <span className="stat-label">{t('manager.aum')}<InfoTip tip="tips.aum" /></span>
              <span className="stat-value">{fmtMoney(holdings.data?.aum)}</span>
              <SparkBar
                values={history.map((h) => h.aum)}
                labels={history.map((h) => quarterLabel(h.reportDate))}
                format={fmtMoney}
              />
            </div>
            <div className="card stat-card">
              <span className="stat-label">{t('manager.positions')}</span>
              <span className="stat-value">{fmtNum(holdings.data?.count)}</span>
              <span className="stat-sub">
                {effN != null && (
                  <>
                    {t('manager.effN')}: <b>{effN.toFixed(1)}</b>
                    <InfoTip tip="tips.effN" />
                  </>
                )}
              </span>
              <SparkBar
                values={history.map((h) => h.positions)}
                labels={history.map((h) => quarterLabel(h.reportDate))}
                format={fmtNum}
                color="--s2"
              />
            </div>
            <div className="card stat-card">
              <span className="stat-label">{t('manager.top10')}<InfoTip tip="tips.top10" /></span>
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
            <div className="card stat-card">
              <span className="stat-label">{t('manager.cash')}<InfoTip tip="tips.cash" /></span>
              {cash.items.length ? (
                <>
                  <span className="stat-value">
                    {fmtPct(cash.weight, { sign: false })}
                    <span className="stat-value-sub"> · {fmtMoney(cash.value)}</span>
                  </span>
                  <span className="stat-sub">
                    {cash.items
                      .slice(0, 4)
                      .map((p) => `${p.ticker || p.issuer} ${fmtPct(p.weight, { sign: false })}`)
                      .join(' · ')}
                    {cash.items.length > 4 ? ` · +${cash.items.length - 4}` : ''}
                  </span>
                </>
              ) : (
                <>
                  <span className="stat-value muted">—</span>
                  <span className="stat-sub">{t('manager.cashNone')}</span>
                </>
              )}
            </div>
          </div>

          {trades && (
            <div className="grid grid-3 mt16">
              <div className="card stat-card">
                <span className="stat-label">{t('manager.activity')}<InfoTip tip="tips.activity" /></span>
                <span className="stat-value">{fmtPct(trades.activity, { sign: false })}</span>
                <span className="stat-sub">
                  {t('manager.activityAvg')}: {fmtPct(mstats.data.activityAvg, { sign: false })}
                </span>
              </div>
              <div className="card stat-card">
                <span className="stat-label">{t('manager.netTrade')}<InfoTip tip="tips.netTrade" /></span>
                <span className={`stat-value ${deltaClass(trades.net)}`}>{signedMoney(trades.net)}</span>
                <span className="stat-sub">
                  {t('manager.bought')} <b>{fmtMoney(trades.bought)}</b> · {t('manager.sold')}{' '}
                  <b>{fmtMoney(trades.sold)}</b>
                </span>
              </div>
              <div className="card stat-card">
                <span className="stat-label">{t('manager.newExit')}</span>
                <span className="stat-value">
                  <span className="delta-pos">+{trades.newCount ?? 0}</span>{' '}
                  <span className="delta-neg">−{trades.exitCount ?? 0}</span>
                </span>
                <span className="stat-sub">
                  {trades.addCount ?? 0} {t('manager.adds')} · {trades.trimCount ?? 0} {t('manager.trims')}
                </span>
              </div>
            </div>
          )}

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

          <div className="card mt16">
            <h3>🏛 {t('manager.fundInfo')}</h3>
            <div className="kv-grid">
              {(mgr.data.address || mgr.data.city) && (
                <div className="kv">
                  <span className="k">{t('manager.address')}</span>
                  <span className="v">
                    {[mgr.data.address, mgr.data.city, mgr.data.state, mgr.data.zip].filter(Boolean).join(', ')}
                  </span>
                </div>
              )}
              {mgr.data.phone && (
                <div className="kv"><span className="k">{t('manager.phone')}</span><span className="v">{mgr.data.phone}</span></div>
              )}
              {mgr.data.website && (
                <div className="kv">
                  <span className="k">{t('manager.website')}</span>
                  <span className="v">
                    <a href={/^https?:/i.test(mgr.data.website) ? mgr.data.website : `https://${mgr.data.website}`} target="_blank" rel="noreferrer">
                      {mgr.data.website}
                    </a>
                  </span>
                </div>
              )}
              <div className="kv"><span className="k">CIK</span><span className="v">{mgr.data.cik}</span></div>
              {mgr.data.firstFiling && (
                <div className="kv"><span className="k">{t('manager.firstFiling')}</span><span className="v">{mgr.data.firstFiling}</span></div>
              )}
              {mgr.data.filingCount > 0 && (
                <div className="kv"><span className="k">{t('manager.filingCount')}</span><span className="v">{mgr.data.filingCount}</span></div>
              )}
              {mgr.data.formerNames?.length > 0 && (
                <div className="kv"><span className="k">{t('manager.formerNames')}</span><span className="v">{mgr.data.formerNames.join(' · ')}</span></div>
              )}
              <div className="kv">
                <span className="k">EDGAR</span>
                <span className="v">
                  <a href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${mgr.data.cik}&type=13F-HR`} target="_blank" rel="noreferrer">
                    {t('manager.edgarLink')}
                  </a>
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {!holdings.isLoading && !holdings.error && tab === 'portfolio' && (
        <>
          <div className="card">
            <h3>🗺 {t('manager.treemap')}</h3>
            <HoldingsTreemap
              positions={positions}
              returns={returns.data}
              labels={{ weight: t('table.weight'), ret: t('table.retYtd') }}
            />
            <p className="muted small mt8">{t('manager.treemapNote')}</p>
          </div>
          <ChangeStory
            positions={positions}
            prevPositions={prevHoldings.data?.positions || null}
          />
          <PositionCards
            positions={positions}
            prevPositions={prevHoldings.data?.positions || null}
          />
          <div className="grid grid-2 mt16">
            <div className="card">
              <h3>{t('manager.composition')}</h3>
              <PortfolioPie positions={positions} />
            </div>
            <div className="card">
              <h3>{t('manager.sectors')}</h3>
              {sectors.isLoading ? (
                <Loading t={t} />
              ) : (
                <SectorPie positions={positions.slice(0, 25)} sectors={sectors.data} />
              )}
            </div>
          </div>
          {benchSeries && (
            <div className="card mt16">
              <h3>{t('manager.benchmark')}</h3>
              <BenchmarkBars series={benchSeries} />
              <p className="muted small mt8">{t('manager.benchmarkNote')}</p>
            </div>
          )}

          {positions.some((p) => p.putCall) && (
            <div className="card mt16">
              <h3>🎯 {t('manager.options')}</h3>
              <div className="head-badges" style={{ marginBottom: 12 }}>
                <span className="badge neg">
                  PUT {fmtPct(positions.filter((p) => /put/i.test(p.putCall)).reduce((s, p) => s + p.weight, 0), { sign: false })}
                </span>
                <span className="badge pos">
                  CALL {fmtPct(positions.filter((p) => /call/i.test(p.putCall)).reduce((s, p) => s + p.weight, 0), { sign: false })}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="l">{t('table.symbol')}</th>
                      <th className="l">{t('table.company')}</th>
                      <th>{t('table.type')}</th>
                      <th>{t('manager.notional')}</th>
                      <th>{t('table.weight')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions
                      .filter((p) => p.putCall)
                      .map((p) => (
                        <tr key={`${p.cusip}|${p.putCall}`}>
                          <td className="l">
                            {p.ticker ? (
                              <Link to={`/stock/${p.ticker}?cusip=${p.cusip}`} style={{ fontWeight: 700 }}>
                                {p.ticker}
                              </Link>
                            ) : (
                              <span className="muted small">{p.cusip}</span>
                            )}
                          </td>
                          <td className="l">{p.issuer}</td>
                          <td>
                            <span className="badge type">{p.putCall.toUpperCase()}</span>
                          </td>
                          <td className="num">{fmtMoney(p.value)}</td>
                          <td className="num">{fmtPct(p.weight, { sign: false, digits: 2 })}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small mt8">{t('manager.optionsNote')}</p>
            </div>
          )}
        </>
      )}

      {!holdings.isLoading && !holdings.error && tab === 'holdings' && (
        <HoldingsTable
          positions={positions}
          prevPositions={prevHoldings.data?.positions || null}
          returns={returns.data}
          cik={mgr.data.cik}
          exportName={`13F_${mgr.data.cik}_${filing?.reportDate || ''}.xlsx`}
        />
      )}
    </div>
  );
}
