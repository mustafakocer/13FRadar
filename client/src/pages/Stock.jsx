import { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import {
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtFracPct,
  fmtRatio,
  deltaClass,
} from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import PositionTimeline from '../components/PositionTimeline.jsx';
import AlertBell from '../components/AlertBell.jsx';
import StockWatchButton from '../components/StockWatchButton.jsx';
import { useAuth } from '../auth.jsx';
import Paywall from '../components/Paywall.jsx';
import PriceChart from '../components/Charts/PriceChart.jsx';
import GuruSignal from '../components/GuruSignal.jsx';
import InfoTip from '../components/InfoTip.jsx';

function KV({ k, v, cls = '', tip }) {
  return (
    <div className="kv">
      <span className="k">
        {k}
        {tip && <InfoTip tip={tip} />}
      </span>
      <span className={`v ${cls}`}>{v}</span>
    </div>
  );
}

function YearTable({ title, rows, cols, t }) {
  if (!rows?.length) return null;
  return (
    <div className="card mt16">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="l"> </th>
              {rows.map((r) => (
                <th key={r.endDate}>{(r.endDate || '').slice(0, 4)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map(([key, label]) => (
              <tr key={key}>
                <td className="l muted">{t(label)}</td>
                {rows.map((r) => (
                  <td key={r.endDate} className="num">
                    {fmtMoney(r[key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Stock() {
  const { ticker } = useParams();
  const [params] = useSearchParams();
  const cusip = params.get('cusip');
  const { t, lang } = useI18n();
  const { isPro } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock', ticker],
    queryFn: () => api.stock(ticker),
  });

  usePageTitle(data?.price?.name ? `${data.price.symbol} · ${data.price.name} — 13F Radar` : null);

  // Who reports this security? CUSIP (exact) when we came from a holdings
  // table, otherwise the company name via EDGAR full-text search.
  const holdersQ = cusip || data?.price?.name?.replace(/\.$/, '') || null;
  const holders = useQuery({
    queryKey: ['holders', holdersQ],
    queryFn: () => api.holders(holdersQ),
    enabled: !!holdersQ,
    staleTime: 6 * 60 * 60 * 1000,
  });

  const insiders = useQuery({
    queryKey: ['insiders', ticker],
    queryFn: () => api.insiders(ticker),
    enabled: isPro,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  const [openHolder, setOpenHolder] = useState(null);
  // WhaleWisdom-style aggregate ownership (needs exact CUSIP)
  const ownership = useQuery({
    queryKey: ['ownership', cusip],
    queryFn: () => api.stockOwnership(cusip),
    enabled: !!cusip && isPro,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  const filings13dg = useQuery({
    queryKey: ['13dg', ticker],
    queryFn: () => api.filings13dg(ticker),
    enabled: isPro,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  if (isLoading)
    return (
      <div className="loading">
        <div className="spinner" />
        {t('common.loading')}
      </div>
    );
  if (error)
    return <div className="error-box">{t('common.error')}: {String(error.message)}</div>;

  const {
    price: p = {},
    valuation: v = {},
    fundamentals: f = {},
    trading: tr = {},
    analyst: an = {},
    profile: pr = {},
  } = data;
  const chg = p.changePercent;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>
            {p.name} <span className="muted" style={{ fontWeight: 600 }}>({p.symbol})</span>
          </h1>
          <div className="row mt8">
            <span className="price-big">
              {p.price != null ? `${fmtNum(p.price, 2)} ${p.currency || ''}` : '—'}
            </span>
            {chg != null && (
              <span className={`badge ${chg >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 15 }}>
                {fmtPct(chg, { digits: 2 })}
              </span>
            )}
            {cusip && <StockWatchButton cusip={cusip} ticker={p.symbol} name={p.name} compact />}
            {cusip && <AlertBell kind="stock" alertKey={cusip} label={p.symbol} compact />}
            {pr.sector && <span className="badge plain">{pr.sector}</span>}
          </div>
        </div>
      </div>

      <GuruSignal ticker={ticker} cusip={cusip} />

      {data.source !== 'quoteSummary' && (
        <div
          className="card"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)', marginBottom: 16 }}
        >
          <span className="small">⚠️ {t('stock.limitedData')}</span>
        </div>
      )}

      <div className="card">
        <div className="kv-grid">
          <KV k={t('stock.open')} v={fmtNum(p.open, 2)} />
          <KV k={t('stock.high')} v={fmtNum(p.high, 2)} />
          <KV k={t('stock.low')} v={fmtNum(p.low, 2)} />
          <KV k={t('stock.prevClose')} v={fmtNum(p.prevClose, 2)} />
          <KV k={t('stock.volume')} v={fmtNum(p.volume)} />
          <KV k={t('stock.mktCap')} v={fmtMoney(p.marketCap)} />
          <KV
            k={t('stock.range52')}
            v={p.low52 != null ? `${fmtNum(p.low52, 2)} – ${fmtNum(p.high52, 2)}` : '—'}
          />
          <KV k={t('stock.eps')} tip="tips.eps" v={fmtRatio(f.eps)} />
        </div>
      </div>

      <div className="card mt16">
        <h3>{t('stock.priceChart')}</h3>
        <PriceChart ticker={ticker} lang={lang} />
      </div>

      <div className="grid grid-2 mt16">
        <div className="card">
          <h3>{t('stock.valuation')}</h3>
          <KV k={t('stock.mktCap')} v={fmtMoney(p.marketCap)} />
          <KV k={t('stock.trailingPE')} tip="tips.pe" v={fmtRatio(v.trailingPE)} />
          <KV k={t('stock.forwardPE')} tip="tips.fpe" v={fmtRatio(v.forwardPE)} />
          <KV k={t('stock.peg')} tip="tips.peg" v={fmtRatio(v.peg)} />
          <KV k={t('stock.ps')} tip="tips.ps" v={fmtRatio(v.priceToSales)} />
          <KV k={t('stock.pb')} tip="tips.pb" v={fmtRatio(v.priceToBook)} />
          <KV k={t('stock.evEbitda')} tip="tips.evEbitda" v={fmtRatio(v.evToEbitda)} />
          <KV k={t('stock.evRevenue')} tip="tips.evRev" v={fmtRatio(v.evToRevenue)} />
          <KV k={t('stock.bookValue')} v={fmtRatio(v.bookValue)} />
          <KV k={t('stock.eps')} v={fmtRatio(f.eps)} />
          <KV k={t('stock.forwardEps')} v={fmtRatio(f.forwardEps)} />
        </div>
        <div className="card">
          <h3>{t('stock.fundamentals')}</h3>
          <KV k={t('stock.revenue')} v={fmtMoney(f.revenue)} />
          <KV
            k={t('stock.revenueGrowth')}
            v={fmtFracPct(f.revenueGrowth)}
            cls={deltaClass(f.revenueGrowth)}
          />
          <KV
            k={t('stock.earningsGrowth')}
            v={fmtFracPct(f.earningsGrowth)}
            cls={deltaClass(f.earningsGrowth)}
          />
          <KV k={t('stock.grossMargin')} tip="tips.gross" v={fmtFracPct(f.grossMargin)} />
          <KV k={t('stock.operatingMargin')} v={fmtFracPct(f.operatingMargin)} />
          <KV k={t('stock.profitMargin')} tip="tips.netm" v={fmtFracPct(f.profitMargin)} />
          <KV k={t('stock.ebitda')} v={fmtMoney(f.ebitda)} />
          <KV k={t('stock.roe')} tip="tips.roe" v={fmtFracPct(f.roe)} />
          <KV k={t('stock.roa')} tip="tips.roa" v={fmtFracPct(f.roa)} />
          <KV k={t('stock.fcf')} v={fmtMoney(f.freeCashflow)} />
          <KV k={t('stock.divYield')} tip="tips.divYield" v={fmtFracPct(f.dividendYield, { digits: 2 })} />
          <KV k={t('stock.dividendRate')} v={fmtRatio(f.dividendRate)} />
          <KV k={t('stock.payoutRatio')} tip="tips.payout" v={fmtFracPct(f.payoutRatio)} />
        </div>
      </div>

      <div className="grid grid-2 mt16">
        <div className="card">
          <h3>{t('stock.trading')}</h3>
          <KV k={t('stock.beta')} tip="tips.beta" v={fmtRatio(tr.beta)} />
          <KV k={t('stock.avgVolume')} v={fmtNum(tr.avgVolume)} />
          <KV k={t('stock.fiftyDayAvg')} tip="tips.ma" v={fmtNum(tr.fiftyDayAvg, 2)} />
          <KV k={t('stock.twoHundredDayAvg')} v={fmtNum(tr.twoHundredDayAvg, 2)} />
          <KV
            k={t('stock.week52Change')}
            v={fmtFracPct(tr.week52Change)}
            cls={deltaClass(tr.week52Change)}
          />
          <KV k={t('stock.sharesOutstanding')} v={fmtNum(tr.sharesOutstanding)} />
          <KV k={t('stock.floatShares')} tip="tips.float" v={fmtNum(tr.floatShares)} />
          <KV k={t('stock.heldInsiders')} v={fmtFracPct(tr.heldInsiders, { digits: 2 })} />
          <KV k={t('stock.heldInstitutions')} tip="tips.inst" v={fmtFracPct(tr.heldInstitutions, { digits: 2 })} />
          <KV k={t('stock.shortRatio')} tip="tips.short" v={fmtRatio(tr.shortRatio)} />
          <KV k={t('stock.shortPercentFloat')} tip="tips.shortFloat" v={fmtFracPct(tr.shortPercentFloat, { digits: 2 })} />
        </div>
        <div className="card">
          <h3>{t('stock.health')}</h3>
          <KV k={t('stock.currentRatio')} tip="tips.current" v={fmtRatio(f.currentRatio)} />
          <KV k={t('stock.quickRatio')} tip="tips.quick" v={fmtRatio(f.quickRatio)} />
          <KV k={t('stock.totalCash')} v={fmtMoney(f.totalCash)} />
          <KV k={t('stock.totalDebt')} v={fmtMoney(f.totalDebt)} />
          <KV k={t('stock.debtEquity')} tip="tips.de" v={fmtRatio(f.debtToEquity)} />
          <h3 className="mt16">{t('stock.analyst')}</h3>
          <KV k={t('stock.targetMean')} v={fmtNum(an.targetMean, 2)} />
          <KV
            k={t('stock.targetRange')}
            v={
              an.targetLow != null && an.targetHigh != null
                ? `${fmtNum(an.targetLow, 2)} – ${fmtNum(an.targetHigh, 2)}`
                : '—'
            }
          />
          <KV
            k={t('stock.recommendation')}
            v={an.recommendation ? t(`reco.${an.recommendation}`) : '—'}
          />
          <KV k={t('stock.analysts')} v={fmtNum(an.analysts)} />
        </div>
      </div>

      <YearTable
        title={t('stock.income')}
        rows={data.income}
        t={t}
        cols={[
          ['revenue', 'stock.revenue'],
          ['grossProfit', 'stock.grossProfit'],
          ['operatingIncome', 'stock.opIncome'],
          ['netIncome', 'stock.netIncome'],
        ]}
      />
      <YearTable
        title={t('stock.balance')}
        rows={data.balance}
        t={t}
        cols={[
          ['totalAssets', 'stock.assets'],
          ['totalLiabilities', 'stock.liabilities'],
          ['equity', 'stock.equity'],
          ['cash', 'stock.cash'],
          ['longTermDebt', 'stock.ltDebt'],
        ]}
      />
      <YearTable
        title={t('stock.cashflow')}
        rows={data.cashflow}
        t={t}
        cols={[
          ['operating', 'stock.opCf'],
          ['investing', 'stock.invCf'],
          ['financing', 'stock.finCf'],
          ['capex', 'stock.capex'],
        ]}
      />

      {data.earnings?.length > 0 && (
        <div className="card mt16">
          <h3>{t('stock.earnings')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">Q</th>
                  <th>{t('stock.epsEst')}</th>
                  <th>{t('stock.epsAct')}</th>
                  <th>{t('stock.surprise')}</th>
                </tr>
              </thead>
              <tbody>
                {data.earnings.map((e) => (
                  <tr key={e.quarter}>
                    <td className="l muted">{e.quarter}</td>
                    <td className="num">{fmtRatio(e.epsEstimate)}</td>
                    <td className="num">{fmtRatio(e.epsActual)}</td>
                    <td className={`num ${deltaClass(e.surprisePercent)}`}>
                      {fmtFracPct(e.surprisePercent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {insiders.data?.transactions?.length > 0 && (
        <div className="card mt16">
          <h3>👤 {t('stock.insiders')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('stock.insDate')}</th>
                  <th className="l">{t('stock.insOwner')}</th>
                  <th className="l">{t('insiders.roleCol')}</th>
                  <th>{t('stock.insSide')}</th>
                  <th>{t('table.shares')}</th>
                  <th>{t('stock.insPrice')}</th>
                  <th>{t('table.value')}</th>
                </tr>
              </thead>
              <tbody>
                {insiders.data.transactions.map((tx, i) => (
                  <tr key={i}>
                    <td className="l muted">{tx.date}</td>
                    <td className="l">{tx.owner}</td>
                    <td className="l muted small" title={tx.title || ''}>{tx.role ? t(`insiders.role.${tx.role}`) : tx.title || '—'}</td>
                    <td>
                      {tx.side ? (
                        <span className={`badge ${tx.side === 'buy' ? 'pos' : 'neg'}`}>
                          {t(`stock.ins.${tx.side}`)}
                          {tx.code ? ` (${tx.code})` : ''}
                        </span>
                      ) : (
                        tx.code || '—'
                      )}
                    </td>
                    <td className="num">{fmtNum(tx.shares)}</td>
                    <td className="num">{fmtNum(tx.price, 2)}</td>
                    <td className="num">{fmtMoney(tx.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small mt8">{t('stock.insidersNote')} <Link to="/insiders">{t('insiders.seeAll')}</Link></p>
        </div>
      )}

      {!isPro && (
        <div className="mt16">
          <Paywall />
        </div>
      )}

      {cusip && isPro && (ownership.isLoading || ownership.data?.holders?.length > 0) && (
        <div className="card mt16">
          <h3>🐋 {t('stock.ownership')}</h3>
          {ownership.isLoading && (
            <div className="muted small">{t('stock.ownershipLoading')}</div>
          )}
          {ownership.data?.holders?.length > 0 && (
            <>
              <div className="head-badges" style={{ marginBottom: 12 }}>
                <span className="badge plain">
                  {t('stock.ownershipFilings')}: {fmtNum(ownership.data.totalFilings)}
                </span>
                <span className="badge plain">
                  {t('consensus.totalValue')}: {fmtMoney(ownership.data.totalValue)}
                </span>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="l">{t('screen.manager')}</th>
                      <th>{t('screen.quarter')}</th>
                      <th>{t('table.shares')}</th>
                      <th>{t('table.value')}</th>
                      <th>{t('table.weight')}</th>
                      <th>Δ {t('table.shares')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ownership.data.holders.map((h) => [
                      <tr
                        key={h.cik}
                        onClick={() => setOpenHolder(openHolder === h.cik ? null : h.cik)}
                        style={{ cursor: 'pointer' }}
                        title={t('table.history')}
                      >
                        <td className="l">
                          <span className="muted">{openHolder === h.cik ? '▾ ' : '▸ '}</span>
                          <Link to={`/manager/${h.cik}`} style={{ fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>
                            {h.name}
                          </Link>
                        </td>
                        <td className="num muted">{h.reportDate}</td>
                        <td className="num">{fmtNum(h.shares)}</td>
                        <td className="num">{fmtMoney(h.value)}</td>
                        <td className="num">{fmtPct(h.weight, { sign: false, digits: 2 })}</td>
                        <td className={`num ${deltaClass(h.dShares)}`}>
                          {h.isNew ? (
                            <span className="badge type">{t('manager.newBadge')}</span>
                          ) : h.dShares != null ? (
                            fmtNum(h.dShares)
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>,
                      openHolder === h.cik ? (
                        <tr key={`${h.cik}-tl`}>
                          <td colSpan={6} className="l" style={{ background: 'var(--surface-2)' }}>
                            <PositionTimeline cik={h.cik} cusip={cusip} />
                          </td>
                        </tr>
                      ) : null,
                    ])}
                  </tbody>
                </table>
              </div>
              <p className="muted small mt8">{t('stock.ownershipNote')}</p>
            </>
          )}
        </div>
      )}

      {filings13dg.data?.filings?.length > 0 && (
        <div className="card mt16">
          <h3>📢 {t('stock.filings13dg')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('stock.insDate')}</th>
                  <th className="l">Form</th>
                  <th className="l">EDGAR</th>
                </tr>
              </thead>
              <tbody>
                {filings13dg.data.filings.map((f) => (
                  <tr key={f.acc}>
                    <td className="l muted">{f.filingDate}</td>
                    <td className="l">
                      <span className={`badge ${/13D/i.test(f.form) ? 'neg' : 'plain'}`}>{f.form}</span>
                    </td>
                    <td className="l">
                      <a href={f.url} target="_blank" rel="noreferrer">
                        {t('stock.view')} ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small mt8">{t('stock.filings13dgNote')}</p>
        </div>
      )}

      {holders.data?.holders?.length > 0 && (
        <div className="card mt16">
          <h3>🏦 {t('stock.holders')}</h3>
          <div className="row" style={{ gap: 8 }}>
            {holders.data.holders.map((h) => (
              <Link key={h.cik} to={`/manager/${h.cik}`} className="chip">
                {h.name}
                <span className="muted small"> · {h.filings}</span>
              </Link>
            ))}
          </div>
          <p className="muted small mt8">{t('stock.holdersNote')}</p>
        </div>
      )}

      {(pr.summary || pr.sector) && (
        <div className="card mt16">
          <h3>{t('stock.about')}</h3>
          <div className="kv-grid" style={{ marginBottom: 12 }}>
            <KV k={t('stock.sector')} v={pr.sector || '—'} />
            <KV k={t('stock.industry')} v={pr.industry || '—'} />
            <KV k={t('stock.employees')} v={fmtNum(pr.employees)} />
            <KV
              k={t('stock.website')}
              v={
                pr.website ? (
                  <a href={pr.website} target="_blank" rel="noreferrer">
                    {pr.website.replace(/^https?:\/\//, '')}
                  </a>
                ) : (
                  '—'
                )
              }
            />
          </div>
          {pr.summary && <p className="about-text">{pr.summary}</p>}
        </div>
      )}
    </div>
  );
}
