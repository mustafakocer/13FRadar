import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, deltaClass, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import FavoriteButton from '../components/FavoriteButton.jsx';
import PositionCards from '../components/PositionCards.jsx';
import ChartBox from '../components/ChartBox.jsx';
import { AumLineChart, FlowBarChart, PortfolioPie, SectorPie, BenchmarkBars, SparkBar, BacktestChart } from '../components/Charts/index.js';
import HoldingsTable from '../components/HoldingsTable.jsx';
import { useSeo } from '../seo.jsx';
import Faq, { Disclaimer } from '../components/Faq.jsx';
import AnswerBox from '../components/AnswerBox.jsx';
import { managerSeo } from '../lib/seoTemplates.js';
import { timeHeldLabel } from '../lib/timeHeld.js';
import { managerPath } from '../lib/paths.js';
import { markFilingSeen } from '../hooks/useSeenFilings.js';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import Paywall from '../components/Paywall.jsx';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import { SkeletonRows, SkeletonStats } from '../components/Skeleton.jsx';
import { managerStyle } from '../data/popular.js';
import ChangeStory from '../components/ChangeStory.jsx';
import InfoTip from '../components/InfoTip.jsx';
import Ico from '../components/Ico.jsx';
import { Printer, FlaskConical, Target, Link as LinkIcon, Newspaper, TriangleAlert } from 'lucide-react';

function Loading({ t }) {
  return (
    <div className="loading">
      <div className="spinner" />
      {t('common.loading')}
    </div>
  );
}

export default function Manager() {
  const { cik: cikParam, slug } = useParams();
  const { t, lang } = useI18n();
  // /guru/:slug and /filer/:slug resolve to a CIK first (seeded on the server)
  const slugQ = useQuery({
    queryKey: ['slug', slug],
    queryFn: () => api.slug(slug),
    enabled: !!slug,
    staleTime: Infinity,
    retry: 0,
  });
  const cik = cikParam || slugQ.data?.cik || null;
  const { isPro } = useAuth();
  const [tab, setTab] = useState('overview');
  const [selAcc, setSelAcc] = useState(null);
  const [btOn, setBtOn] = useState(false);

  const mgr = useQuery({ queryKey: ['manager', cik], queryFn: () => api.manager(cik), enabled: !!cik });

  const filings = mgr.data?.filings || [];
  const acc = selAcc || filings[0]?.acc;
  const filing = filings.find((f) => f.acc === acc);
  const prevFiling = filings[filings.findIndex((f) => f.acc === acc) + 1];

  // Pro asks for the whole portfolio (private response); free gets the
  // server-truncated top 10 plus the true totals.
  const holdings = useQuery({
    queryKey: ['holdings', cik, acc, isPro],
    queryFn: () => api.holdings(cik, acc, isPro ? { full: '1' } : {}),
    enabled: !!acc,
    staleTime: 6 * 60 * 60 * 1000,
  });

  // Previous quarter for change detection. Free users may only fetch the
  // CUSIPs they can already see, so exits below the top 10 stay Pro-only.
  const visibleCusips = (holdings.data?.positions || []).slice(0, 10).map((p) => p.cusip);
  const prevHoldings = useQuery({
    queryKey: ['holdings-light', cik, prevFiling?.acc, isPro, isPro ? '' : visibleCusips.join(',')],
    queryFn: () =>
      api.holdings(
        cik,
        prevFiling.acc,
        isPro ? { light: '1', full: '1' } : { light: '1', cusips: visibleCusips.join(',') }
      ),
    enabled: !!prevFiling && (isPro || visibleCusips.length > 0),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const prevByCusip = useMemo(
    () => new Map((prevHoldings.data?.positions || []).map((p) => [p.cusip, p])),
    [prevHoldings.data]
  );

  const aumHist = useQuery({
    queryKey: ['aum', cik],
    queryFn: () => api.aumHistory(cik),
    enabled: !!cik,
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

  // precomputed 10-year history for curated gurus (404 for other filers)
  const hist = useQuery({
    queryKey: ['guru-history', cik],
    queryFn: () => api.guruHistory(cik),
    enabled: !!cik,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 0,
  });
  const hasHist = !!hist.data?.quarters?.length;
  const guruSlug = mgr.data?.kind === 'guru' ? mgr.data.slug : null;

  const seo = useMemo(
    () =>
      managerSeo({
        lang,
        cik,
        manager: mgr.data,
        filing,
        holdings: holdings.data,
        prevPositions: prevHoldings.data?.positions ?? null,
        history: hist.data || null,
      }),
    [lang, cik, mgr.data, filing, holdings.data, prevHoldings.data, hist.data]
  );
  useSeo(seo);

  // mark the latest filing as "seen" for watchlist NEW badges
  const latestFiled = filings[0]?.filingDate;
  // A 13F is due 45 days after the quarter it covers, so a fund that is still
  // filing is never more than ~135 days behind. Past that, EDGAR has nothing
  // newer under this CIK — the fund stopped filing, or it files under another
  // entity now — and the positions below are history, not a current portfolio.
  const newestReport = filings[0]?.reportDate;
  const dormant =
    newestReport && (Date.now() - Date.parse(`${newestReport}T00:00:00Z`)) / 86400000 > 200;
  useEffect(() => {
    if (mgr.data && latestFiled) markFilingSeen(mgr.data.cik, latestFiled);
  }, [mgr.data, latestFiled]);

  const backtest = useQuery({
    queryKey: ['backtest', cik],
    queryFn: () => api.backtest(cik, { quarters: 8, top: 15 }),
    enabled: btOn,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });


  // related managers by holdings overlap (nightly precompute; 404 = none)
  const related = useQuery({
    queryKey: ['related', cik],
    queryFn: () => api.related(cik),
    enabled: !!cik,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });

  const mstats = useQuery({
    queryKey: ['mstats', cik],
    queryFn: () => api.managerStats(cik),
    enabled: !!cik,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  if (slug && slugQ.error) return <div className="error-box">{t('common.error')}: {t('manager.unknownSlug')}</div>;
  if (!cik || mgr.isLoading) return <Loading t={t} />;
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
            <h1>{mgr.data.displayName || mgr.data.name}</h1>
            <div className="sub">
              {mgr.data.displayName && mgr.data.displayName !== mgr.data.name ? `${mgr.data.name} · ` : ''}CIK {mgr.data.cik}
              {mgr.data.city ? ` · ${mgr.data.city}, ${mgr.data.state}` : ''}
              {filing ? ` · ${t('manager.quarterEnd')}: ${filing.reportDate} · ${t('manager.filedOn')}: ${filing.filingDate}` : ''}
            </div>
            <div className="head-badges">
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
          <button className="btn ghost no-print" onClick={() => window.print()}>
            <Ico icon={Printer} /> {t('manager.print')}
          </button>
          <select className="select" value={acc || ''} onChange={(e) => setSelAcc(e.target.value)}>
            {filings.map((f) => (
              <option key={f.acc} value={f.acc}>
                {quarterLabel(f.reportDate)} {f.form === '13F-HR/A' ? '(A)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {dormant && (
        <div
          className="card"
          style={{ background: 'var(--popover)', borderColor: 'var(--border-strong)', marginBottom: 16 }}
        >
          <span className="small">
            <Ico icon={TriangleAlert} size={14} />{' '}
            {t('manager.dormant')
              .replace('{q}', quarterLabel(filings[0].reportDate))
              .replace('{d}', filings[0].filingDate)}
          </span>
        </div>
      )}

      <AnswerBox text={seo.answer} />

      <div className="tabs">
        {['overview', 'portfolio', 'holdings', ...(hasHist ? ['history'] : [])].map((k) => (
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
          <div className="grid grid-3">
            <div className="card stat-card">
              <span className="stat-label">{t('manager.aum')}<InfoTip tip="tips.aum" /></span>
              <span className="stat-value">{fmtMoney(holdings.data?.aum)}</span>
              <ChartBox height={44} style={{ marginTop: 0 }}><SparkBar values={history.map((h) => h.aum)} /></ChartBox>
            </div>
            <div className="card stat-card">
              <span className="stat-label">{t('manager.positions')}</span>
              <span className="stat-value">{fmtNum(holdings.data?.count)}</span>
              <ChartBox height={44} style={{ marginTop: 0 }}><SparkBar values={history.map((h) => h.positions)} color="--chart-2" /></ChartBox>
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
          </div>

          {mstats.isLoading && (
            <div className="grid grid-3 mt16">
              {[0, 1, 2].map((i) => (
                <div className="card stat-card" key={i} style={{ minHeight: 118 }}>
                  <div className="skel skel-row" style={{ width: '40%' }} />
                  <div className="skel skel-row" style={{ height: 26, width: '30%' }} />
                </div>
              ))}
            </div>
          )}
          {mstats.data?.quarters >= 2 && (
            <div className="grid grid-3 mt16">
              <div className="card stat-card">
                <span className="stat-label">{t('manager.turnover')}<InfoTip tip="tips.turnover" /></span>
                <span className="stat-value">
                  {fmtPct(mstats.data.turnoverLatest, { sign: false })}
                </span>
                <span className="stat-sub">
                  {t('manager.turnoverAvg')}: {fmtPct(mstats.data.turnoverAvg, { sign: false })}
                </span>
              </div>
              <div className="card stat-card">
                <span className="stat-label">{t('manager.avgHold')}<InfoTip tip="tips.avgHold" /></span>
                <span className="stat-value">
                  {mstats.data.avgHoldingQuarters != null
                    ? `${mstats.data.avgHoldingQuarters.toFixed(1)}`
                    : '—'}
                </span>
                <span className="stat-sub">{t('manager.avgHoldUnit')}</span>
              </div>
              <div className="card stat-card">
                <span className="stat-label">{t('manager.newExit')}</span>
                <span className="stat-value">
                  <span className="delta-pos">{mstats.data.newCount ?? 0}</span>{' '}
                  <span className="delta-neg">{mstats.data.exitCount ?? 0}</span>
                </span>
                <span className="stat-sub">{t('manager.newExitSub')}</span>
              </div>
            </div>
          )}

          <div className="card mt16">
            <h3>{t('manager.topHoldings')} · {filing ? quarterLabel(filing.reportDate) : ''}</h3>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="l">{t('table.rank')}</th>
                    <th className="l">{t('table.symbol')}</th>
                    <th className="l">{t('table.company')}</th>
                    <th>{t('table.weight')}</th>
                    <th>{t('table.value')}</th>
                    <th>{t('table.shares')}</th>
                    <th>{t('table.delta')}</th>
                    {hasHist && <th>{t('hist.timeHeld')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {positions.slice(0, 10).map((p, i) => {
                    const q = prevByCusip.get(p.cusip);
                    const d = q && q.shares > 0 ? ((p.shares - q.shares) / q.shares) * 100 : null;
                    return (
                      <tr key={`${p.cusip}|${p.putCall}`}>
                        <td className="l muted">{i + 1}</td>
                        <td className="l">
                          {p.ticker ? (
                            <Link to={`/stock/${p.ticker}?cusip=${p.cusip}`} style={{ fontWeight: 700 }}>{p.ticker}</Link>
                          ) : (
                            <span className="muted small">{p.cusip}</span>
                          )}
                          {p.putCall && <span className="badge type" style={{ marginLeft: 6 }}>{p.putCall}</span>}
                        </td>
                        <td className="l">{p.issuer}</td>
                        <td className="num">{fmtPct(p.weight, { sign: false, digits: 2 })}</td>
                        <td className="num">{fmtMoney(p.value)}</td>
                        <td className="num">{fmtNum(p.shares)}</td>
                        <td className={`num ${prevHoldings.data ? (q ? deltaClass(d) : 'delta-pos') : 'muted'}`}>
                          {!prevHoldings.data ? '—' : q ? fmtPct(d) : t('manager.newBadge')}
                        </td>
                        {hasHist && (
                          <td className="num">
                            {guruSlug && p.ticker && hist.data.timeHeld[p.cusip] ? (
                              <Link to={`/guru/${guruSlug}/${p.ticker}`}>{timeHeldLabel(hist.data.timeHeld[p.cusip].quarters, lang)}</Link>
                            ) : (
                              timeHeldLabel(hist.data.timeHeld[p.cusip]?.quarters, lang) || '—'
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {holdings.data?.count > 10 && (
              <p className="muted small mt8">
                10 {t('table.showing')} · {fmtNum(holdings.data.count)} {t('manager.positions').toLowerCase()} ·{' '}
                <button className="linklike" onClick={() => setTab('holdings')}>{t('manager.holdings')} →</button>
              </p>
            )}
          </div>

          <div className="card mt16">
            <h3>{t('manager.aumHistory')}</h3>
            <ChartBox height={260}>
              {aumHist.isLoading ? (
                <div className="skel" style={{ height: 260, borderRadius: 10 }} />
              ) : history.length > 1 ? (
                <AumLineChart history={history} />
              ) : (
                <div className="muted small">{t('common.na')}</div>
              )}
            </ChartBox>
          </div>

          {history.some((h) => h.estFlow != null) && (
            <div className="card mt16">
              <h3>{t('manager.flowHistory')}</h3>
              <ChartBox height={200}><FlowBarChart history={history} label={t('manager.estFlow')} /></ChartBox>
              <p className="muted small mt8">{t('manager.flowNote')}</p>
            </div>
          )}

          <div className="card mt16 no-print">
            <h3><Ico icon={FlaskConical} /> {t('manager.backtest')}</h3>
            {!isPro && <Paywall compact />}
            {isPro && !btOn && (
              <>
                <p className="muted small" style={{ marginBottom: 12 }}>
                  {t('manager.backtestNote')}
                </p>
                <button className="btn" onClick={() => setBtOn(true)}>
                  {t('manager.backtestRun')}
                </button>
              </>
            )}
            {btOn && backtest.isLoading && <Loading t={t} />}
            {btOn && backtest.error && (
              <div className="muted small">{t('common.error')}: {String(backtest.error.message)}</div>
            )}
            {btOn && backtest.data?.points?.length > 1 && (
              <>
                <div className="head-badges" style={{ marginBottom: 12 }}>
                  <span className={`badge ${backtest.data.totalPort >= 0 ? 'pos' : 'neg'}`}>
                    {t('manager.portfolioSeries')} {fmtPct(backtest.data.totalPort)}
                  </span>
                  <span className={`badge ${backtest.data.totalSpy >= 0 ? 'pos' : 'neg'}`}>
                    SPY {fmtPct(backtest.data.totalSpy)}
                  </span>
                  {backtest.data.coverage != null && (
                    <span className="badge plain">
                      {t('manager.backtestCoverage')}: {fmtPct(backtest.data.coverage, { sign: false, digits: 0 })}
                    </span>
                  )}
                </div>
                <ChartBox height={260}><BacktestChart
                  points={backtest.data.points}
                  labels={{ port: t('manager.portfolioSeries') }}
                /></ChartBox>
                <p className="muted small mt8">{t('manager.backtestNote')}</p>
              </>
            )}
            {btOn && backtest.data && !(backtest.data.points?.length > 1) && !backtest.isLoading && (
              <div className="muted small">{t('common.na')}</div>
            )}
          </div>
        </>
      )}

      {!holdings.isLoading && !holdings.error && tab === 'portfolio' && (
        <>
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
              <ChartBox height={300}><PortfolioPie positions={positions} /></ChartBox>
            </div>
            <div className="card">
              <h3>{t('manager.sectors')}</h3>
              {sectors.isLoading ? (
                <Loading t={t} />
              ) : (
                <ChartBox height={300}><SectorPie positions={positions.slice(0, 25)} sectors={sectors.data} /></ChartBox>
              )}
            </div>
          </div>
          {benchSeries && (
            <div className="card mt16">
              <h3>{t('manager.benchmark')}</h3>
              <ChartBox height={240}><BenchmarkBars series={benchSeries} /></ChartBox>
              <p className="muted small mt8">{t('manager.benchmarkNote')}</p>
            </div>
          )}

          {positions.some((p) => p.putCall) && (
            <div className="card mt16">
              <h3><Ico icon={Target} /> {t('manager.options')}</h3>
              <div className="head-badges" style={{ marginBottom: 12 }}>
                <span className="badge plain">
                  PUT {fmtPct(positions.filter((p) => /put/i.test(p.putCall)).reduce((s, p) => s + p.weight, 0), { sign: false })}
                </span>
                <span className="badge plain">
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

      {tab === 'history' && hasHist && (
        <div className="card">
          <h3>{t('hist.title')} · {hist.data.lookback} {t('screen.quarter')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('hist.quarter')}</th>
                  <th className="l">{t('hist.filed')}</th>
                  <th>{t('hist.count')}</th>
                  <th>{t('hist.value')}</th>
                  <th>{t('hist.turnover')}</th>
                  <th className="l">{t('hist.top10')}</th>
                </tr>
              </thead>
              <tbody>
                {[...hist.data.quarters].reverse().map((q) => (
                  <tr key={q.acc}>
                    <td className="l"><b>{quarterLabel(q.reportDate)}</b></td>
                    <td className="l muted">{q.filed}</td>
                    <td className="num">{fmtNum(q.count)}</td>
                    <td className="num">{fmtMoney(q.aum)}</td>
                    <td className="num">{q.turnover != null ? fmtPct(q.turnover, { sign: false }) : '—'}</td>
                    <td className="l small">
                      {q.top10.map((tk, i) => (
                        <span key={`${tk}-${i}`}>
                          {i > 0 && ', '}
                          {/^[A-Z0-9.\-]{1,6}$/.test(tk) ? (
                            guruSlug ? <Link to={`/guru/${guruSlug}/${tk}`}>{tk}</Link> : <Link to={`/stock/${tk}`}>{tk}</Link>
                          ) : (
                            <span className="muted">{tk}</span>
                          )}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small mt8">{t('hist.splitNote')}</p>
        </div>
      )}

      {!holdings.isLoading && !holdings.error && tab === 'holdings' && (
        <HoldingsTable
          positions={positions}
          prevPositions={prevHoldings.data?.positions || null}
          returns={returns.data}
          cik={mgr.data.cik}
          total={holdings.data?.count}
          locked={!!holdings.data?.locked}
          exportName={`13F_${mgr.data.cik}_${filing?.reportDate || ''}.xlsx`}
        />
      )}
      {related.data?.related?.length > 0 && (
        <div className="card mt16">
          <h3><Ico icon={LinkIcon} /> {t('related.title')}</h3>
          <p className="muted small" style={{ marginBottom: 8 }}>{t('related.note')}</p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th className="l">{t('screen.manager')}</th><th>{t('related.overlap')}</th><th className="l">{t('related.shared')}</th></tr></thead>
              <tbody>
                {related.data.related.map((r) => (
                  <tr key={r.cik}>
                    <td className="l"><Link to={r.slug ? `/guru/${r.slug}` : managerPath(r.cik)} style={{ fontWeight: 700 }}>{r.name}</Link></td>
                    <td className="num">{fmtPct(r.jaccard * 100, { sign: false })}</td>
                    <td className="l small">
                      {r.shared.map((tk, i) => (
                        <span key={tk}>{i > 0 && ', '}{/^[A-Z0-9.\-]{1,6}$/.test(tk) ? <Link to={`/stock/${tk}`}>{tk}</Link> : <span className="muted">{tk}</span>}</span>
                      ))}
                      {r.sharedCount > r.shared.length && ` +${r.sharedCount - r.shared.length}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {mgr.data.latestReport && (
        <p className="muted small mt16">
          <Ico icon={Newspaper} /> <Link to={`/reports/${mgr.data.latestReport}`}>{t('related.report').replace('{q}', mgr.data.latestReport.toUpperCase())}</Link> · <Link to="/calendar">{t('cal.title')}</Link>
        </p>
      )}
      <Faq items={seo.faq} />
      <Disclaimer />
    </div>
  );
}
