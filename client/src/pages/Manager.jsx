import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, fmtTurnover, deltaClass, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import FavoriteButton from '../components/FavoriteButton.jsx';
import PositionCards from '../components/PositionCards.jsx';
import ChartBox from '../components/ChartBox.jsx';
import { AumLineChart, FlowBarChart, PortfolioPie, SectorPie, BenchmarkBars, BacktestChart } from '../components/Charts/index.js';
import HoldingsTable from '../components/HoldingsTable.jsx';
import { useSeo } from '../seo.jsx';
import Faq, { Disclaimer } from '../components/Faq.jsx';
import AnswerBox from '../components/AnswerBox.jsx';
import { managerSeo } from '../lib/seoTemplates.js';
import { managerPath } from '../lib/paths.js';
import { securityLabel } from '../lib/label.js';
import { markFilingSeen } from '../hooks/useSeenFilings.js';
import { useAuth } from '../auth.jsx';
import Paywall from '../components/Paywall.jsx';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import { SkeletonRows, SkeletonStats } from '../components/Skeleton.jsx';
import { managerStyle } from '../data/popular.js';
import ChangeStory from '../components/ChangeStory.jsx';
import InfoTip from '../components/InfoTip.jsx';
import Ico from '../components/Ico.jsx';
import { Printer, FlaskConical, Target, Link as LinkIcon, Newspaper, TriangleAlert } from 'lucide-react';

// The same shape as the consensus page: the four numbers that frame the
// quarter, the segments of the page as pages of their own — /guru/<slug>,
// /guru/<slug>/changes, /mix, /history, /backtest — and on each one thing: a
// table, or a pair of charts, rather than everything at once. The old overview stacked six stat cards, a top-ten table, two charts
// and the backtest in a single scroll and then repeated the table on another
// tab; a reader looking for one number had to pass every other one.
const TABS = ['portfolio', 'changes', 'mix', 'history', 'backtest'];

function Loading({ t }) {
  return (
    <div className="loading">
      <div className="spinner" />
      {t('common.loading')}
    </div>
  );
}

function Kpi({ label, tip, value, sub, cls = '' }) {
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div className="small muted">
        {label}
        {tip && <InfoTip tip={tip} />}
      </div>
      <div className={cls} style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
        {value}
      </div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

// segment: which sub-page this route mounts; the routes pass it in because
// the sub-page path is a fixed word, not a URL parameter.
export default function Manager({ segment = 'portfolio' }) {
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

  const tab = TABS.includes(segment) ? segment : 'portfolio';
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

  const sectorTickers = topTickers.slice(0, 25);
  const sectors = useQuery({
    queryKey: ['sectors', sectorTickers.join(',')],
    queryFn: () => api.sectors(sectorTickers),
    enabled: tab === 'mix' && sectorTickers.length > 0,
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
        segment: tab,
      }),
    [lang, cik, mgr.data, filing, holdings.data, prevHoldings.data, hist.data, tab]
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
  const top10 = positions.slice(0, 10).reduce((s, p) => s + p.weight, 0);

  // Current-portfolio weighted 1Y/YTD return over resolved top-50 tickers.
  // The 1D figure the header used to carry is gone: a one-day move on a
  // portfolio disclosed 45 days late is noise dressed as a number.
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
  const spy1y = returns.data?.SPY?.ret1y ?? null;
  const benchSeries =
    port1y != null && returns.data
      ? [
          { label: t('manager.portfolioSeries'), ret1y: port1y, retYtd: portYtd },
          ...['SPY', 'QQQ', 'IWM']
            .filter((s) => returns.data[s])
            .map((s) => ({ label: s, ret1y: returns.data[s].ret1y, retYtd: returns.data[s].retYtd })),
        ]
      : null;

  const ms = mstats.data?.quarters >= 2 ? mstats.data : null;
  const ready = !holdings.isLoading && !holdings.error;
  const optionRows = positions.filter((p) => p.putCall);
  // the fund's canonical front, which every segment hangs off
  const base = mgr.data.path || managerPath(mgr.data.cik);
  const secUrl = filing
    ? `https://www.sec.gov/Archives/edgar/data/${Number(mgr.data.cik)}/${String(filing.acc).replace(/-/g, '')}/`
    : null;
  // A quarter is one row whatever was filed for it; when a 13F-HR/A was
  // folded into the snapshot the page says so, with the date, in one badge.
  const amendments = holdings.data?.amendments || filing?.amendments || [];
  const amendedOn = (holdings.data?.amended || filing?.amended) && amendments.length ? amendments.map((a) => a.filingDate).join(', ') : null;

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
              {/* Straight to the document these numbers were read from, so a
                  reader can check a figure against the filing itself rather
                  than take the site's word for it. */}
              {secUrl && (
                <>
                  {' · '}
                  <a href={secUrl} target="_blank" rel="noopener noreferrer">{t('guru.verify')} ↗</a>
                </>
              )}
              {managerStyle(mgr.data.cik) && (
                <span className="badge plain sm" style={{ marginLeft: 8 }}>{t(`style.${managerStyle(mgr.data.cik)}`)}</span>
              )}
              {amendedOn && (
                <span className="badge plain sm" style={{ marginLeft: 8 }} title={t('tips.amended')}>
                  {t('manager.amended').replace('{d}', amendedOn)}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="row">
          <button className="btn ghost no-print" onClick={() => window.print()}>
            <Ico icon={Printer} /> {t('manager.print')}
          </button>
          <select className="select" value={acc || ''} onChange={(e) => setSelAcc(e.target.value)} aria-label={t('manager.filings')}>
            {filings.map((f) => (
              <option key={f.acc} value={f.acc}>
                {quarterLabel(f.reportDate)}{f.amended ? ' ✎' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {dormant && (
        <div className="card" style={{ background: 'var(--popover)', borderColor: 'var(--border-strong)', marginBottom: 16 }}>
          <span className="small">
            <Ico icon={TriangleAlert} size={14} />{' '}
            {t('manager.dormant').replace('{q}', quarterLabel(filings[0].reportDate)).replace('{d}', filings[0].filingDate)}
          </span>
        </div>
      )}

      <AnswerBox text={seo.answer} />

      {holdings.isLoading && (
        <>
          <SkeletonStats />
          <div className="mt16"><SkeletonRows rows={7} /></div>
        </>
      )}
      {holdings.error && <div className="error-box">{t('common.error')}: {String(holdings.error.message)}</div>}

      {ready && (
        <>
          {/* ---- the four numbers that frame the quarter ------------------ */}
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <Kpi
              label={t('manager.aum')}
              tip="tips.aum"
              value={fmtMoney(holdings.data?.aum)}
              sub={
                latest?.qoq != null ? (
                  <>{t('manager.qoq')} <b className={deltaClass(latest.qoq)}>{fmtPct(latest.qoq)}</b></>
                ) : (
                  filing && quarterLabel(filing.reportDate)
                )
              }
            />
            <Kpi
              label={t('manager.positions')}
              value={fmtNum(holdings.data?.count)}
              sub={
                ms
                  ? t('manager.kpi.newExit').replace('{n}', fmtNum(ms.newCount ?? 0)).replace('{m}', fmtNum(ms.exitCount ?? 0))
                  : latest?.yoy != null && <>{t('manager.yoy')} <b className={deltaClass(latest.yoy)}>{fmtPct(latest.yoy)}</b></>
              }
            />
            <Kpi
              label={t('manager.top10')}
              tip="tips.top10"
              value={fmtPct(top10, { sign: false })}
              sub={
                ms
                  ? `${t('manager.kpi.turnover')} ${fmtTurnover(ms.turnoverLatest)}`
                  : latest?.estFlow != null && <>{t('manager.estFlow')} <b className={deltaClass(latest.estFlow)}>{fmtMoney(latest.estFlow)}</b></>
              }
            />
            {port1y != null ? (
              <Kpi
                label={t('manager.ret1y')}
                value={fmtPct(port1y)}
                cls={deltaClass(port1y)}
                sub={spy1y != null ? `SPY ${fmtPct(spy1y)} · ${t('manager.ret1yNote')}` : t('manager.ret1yNote')}
              />
            ) : (
              <Kpi
                label={t('manager.estFlow')}
                value={latest?.estFlow != null ? fmtMoney(latest.estFlow) : '—'}
                cls={latest?.estFlow != null ? deltaClass(latest.estFlow) : ''}
                sub={filing && quarterLabel(filing.reportDate)}
              />
            )}
          </div>

          {/* ---- segments ------------------------------------------------ */}
          <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {TABS.map((k) => (
              <Link
                key={k}
                to={k === 'portfolio' ? base : `${base}/${k}`}
                className={`chip${tab === k ? ' fsel-active' : ''}${k === 'backtest' ? ' no-print' : ''}`}
                aria-current={tab === k ? 'page' : undefined}
              >
                {t(`manager.tab.${k}`)}
                {k === 'backtest' && !isPro && <span className="badge pro sm" style={{ marginLeft: 6 }}>PRO</span>}
              </Link>
            ))}
          </div>

          {/* ---- one thing per segment ----------------------------------- */}
          {tab === 'portfolio' && (
            <HoldingsTable
              positions={positions}
              prevPositions={prevHoldings.data?.positions || null}
              returns={returns.data}
              cik={mgr.data.cik}
              total={holdings.data?.count}
              locked={!!holdings.data?.locked}
              exportName={`13F_${mgr.data.cik}_${filing?.reportDate || ''}.xlsx`}
              timeHeld={hasHist ? hist.data.timeHeld : null}
              guruSlug={guruSlug}
            />
          )}

          {tab === 'changes' && (
            <>
              <ChangeStory positions={positions} prevPositions={prevHoldings.data?.positions || null} />
              <PositionCards positions={positions} prevPositions={prevHoldings.data?.positions || null} />
            </>
          )}

          {tab === 'mix' && (
            <>
              <div className="grid grid-2">
                <div className="card">
                  <h3>{t('manager.composition')}</h3>
                  <ChartBox height={300}><PortfolioPie positions={positions} /></ChartBox>
                </div>
                <div className="card">
                  <h3>{t('manager.sectors')}</h3>
                  {/* The box stays mounted while the sector lookup runs: the
                      chart takes a `loading` flag instead of being swapped
                      for a spinner and re-created when the answer lands. */}
                  <ChartBox height={300}>
                    <SectorPie positions={positions.slice(0, 25)} sectors={sectors.data} loading={sectors.isLoading} />
                  </ChartBox>
                  <p className="muted small mt8">{t('manager.sectorsNote')}</p>
                </div>
              </div>
              {benchSeries && (
                <div className="card mt16">
                  <h3>{t('manager.benchmark')}</h3>
                  <ChartBox height={240}><BenchmarkBars series={benchSeries} /></ChartBox>
                  <p className="muted small mt8">{t('manager.benchmarkNote')}</p>
                </div>
              )}
              {optionRows.length > 0 && (
                <div className="card mt16">
                  <h3><Ico icon={Target} /> {t('manager.options')}</h3>
                  <div className="head-badges" style={{ marginBottom: 12 }}>
                    <span className="badge plain">
                      PUT {fmtPct(optionRows.filter((p) => /put/i.test(p.putCall)).reduce((s, p) => s + p.weight, 0), { sign: false })}
                    </span>
                    <span className="badge plain">
                      CALL {fmtPct(optionRows.filter((p) => /call/i.test(p.putCall)).reduce((s, p) => s + p.weight, 0), { sign: false })}
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
                        {optionRows.map((p) => (
                          <tr key={`${p.cusip}|${p.putCall}`}>
                            <td className="l">
                              {p.ticker ? (
                                <Link to={`/stock/${p.ticker}?cusip=${p.cusip}`} style={{ fontWeight: 700 }}>{p.ticker}</Link>
                              ) : (
                                <span className="muted small" title={p.cusip}>{securityLabel(p).text}</span>
                              )}
                            </td>
                            <td className="l">{p.issuer}</td>
                            <td><span className="badge type">{p.putCall.toUpperCase()}</span></td>
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

          {tab === 'history' && (
            <>
              <div className="card">
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
              {hasHist && (
                <div className="card mt16">
                  <h3>{t('hist.title')} · {hist.data.lookback} {t('screen.quarter')}</h3>
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th className="l">{t('hist.quarter')}</th>
                          <th className="l">{t('hist.filed')}</th>
                          <th>{t('hist.count')}</th>
                          <th>{t('hist.value')}</th>
                          <th>{t('hist.turnover')}<InfoTip tip="tips.turnover" /></th>
                          <th className="l">{t('hist.top10')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...hist.data.quarters].reverse().map((q) => (
                          <tr key={q.acc}>
                            <td className="l">
                              <b>{quarterLabel(q.reportDate)}</b>
                              {q.amended?.length > 0 && (
                                <span className="badge plain sm" style={{ marginLeft: 6 }} title={`13F-HR/A ${q.amended.map((a) => a.filed).join(', ')}`}>
                                  ✎ {t('hist.amended')}
                                </span>
                              )}
                            </td>
                            <td className="l muted">{q.filed}</td>
                            <td className="num">{fmtNum(q.count)}</td>
                            <td className="num">{fmtMoney(q.aum)}</td>
                            <td className="num">{fmtTurnover(q.turnover)}</td>
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
            </>
          )}

          {tab === 'backtest' && (
            <div className="card no-print">
              <h3><Ico icon={FlaskConical} /> {t('manager.backtest')}</h3>
              {!isPro && <Paywall compact />}
              {isPro && !btOn && (
                <>
                  <p className="muted small" style={{ marginBottom: 12 }}>{t('manager.backtestNote')}</p>
                  <button className="btn" onClick={() => setBtOn(true)}>{t('manager.backtestRun')}</button>
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
                    {backtest.data.benchmark && backtest.data.totalSpy != null && (
                      <span className={`badge ${backtest.data.totalSpy >= 0 ? 'pos' : 'neg'}`}>{backtest.data.benchmark} {fmtPct(backtest.data.totalSpy)}</span>
                    )}
                    {backtest.data.coverage != null && (
                      <span
                        className={`badge ${backtest.data.coverage < 70 ? 'warn' : 'plain'}`}
                        title={
                          backtest.data.skipped?.length
                            ? `${t('manager.backtestSkipped')}: ${backtest.data.skipped.map((s) => `${s.ticker || s.issuer || s.cusip} (${t(`manager.backtestReason.${s.reason}`)})`).join(', ')}`
                            : undefined
                        }
                      >
                        {t('manager.backtestCoverage')}: {fmtPct(backtest.data.coverage, { sign: false, digits: 0 })}
                      </span>
                    )}
                  </div>
                  {backtest.data.coverage != null && backtest.data.coverage < 70 && (
                    <div className="notice warn small" style={{ marginBottom: 12 }}>
                      {t('manager.backtestLowCoverage').replace('{pct}', fmtPct(backtest.data.coverage, { sign: false, digits: 0 }))}
                      {backtest.data.skipped?.length > 0 && (
                        <>
                          {' '}
                          {t('manager.backtestSkipped')}: {backtest.data.skipped.map((s) => s.ticker || s.issuer || s.cusip).join(', ')}
                        </>
                      )}
                    </div>
                  )}
                  {!backtest.data.benchmark && <div className="muted small" style={{ marginBottom: 8 }}>{t('manager.backtestNoBenchmark')}</div>}
                  <ChartBox height={260}>
                    <BacktestChart points={backtest.data.points} labels={{ port: t('manager.portfolioSeries') }} benchmark={backtest.data.benchmark} />
                  </ChartBox>
                  <p className="muted small mt8">{t('manager.backtestNote')}</p>
                </>
              )}
              {btOn && backtest.data && !(backtest.data.points?.length > 1) && !backtest.isLoading && (
                <div className="muted small">{t('common.na')}</div>
              )}
            </div>
          )}
        </>
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
