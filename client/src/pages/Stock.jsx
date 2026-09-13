import { useMemo } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useSeo } from '../seo.jsx';
import Faq, { Disclaimer } from '../components/Faq.jsx';
import AnswerBox from '../components/AnswerBox.jsx';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { stockSeo } from '../lib/seoTemplates.js';
import {
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtFracPct,
  fmtRatio,
  deltaClass,
} from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import Paywall from '../components/Paywall.jsx';
import ChartBox from '../components/ChartBox.jsx';
import { PriceChart } from '../components/Charts/index.js';
import GuruSignal from '../components/GuruSignal.jsx';
import InfoTip from '../components/InfoTip.jsx';
import { managerPath } from '../lib/paths.js';
import Ico from '../components/Ico.jsx';
import { TriangleAlert, UserRound, Waves } from 'lucide-react';

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


  const insiders = useQuery({
    queryKey: ['insiders', ticker],
    queryFn: () => api.insiders(ticker),
    enabled: isPro,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  // WhaleWisdom-style aggregate ownership (needs exact CUSIP)
  const ownership = useQuery({
    queryKey: ['ownership', cusip],
    queryFn: () => api.stockOwnership(cusip),
    enabled: !!cusip && isPro,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 1,
  });

  const consensus = useConsensusStatic();
  const consensusRow = useMemo(() => {
    const rows = consensus.data?.mostHeld || [];
    return rows.find((r) => (cusip && r.cusip === cusip) || (r.ticker && r.ticker === ticker)) || null;
  }, [consensus.data, cusip, ticker]);
  const reportDate = useMemo(() => (consensus.data?.managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), ''), [consensus.data]);
  const seo = useMemo(
    () => stockSeo({ lang, ticker, cusip, stock: data, consensusRow, reportDate }),
    [lang, ticker, cusip, data, consensusRow, reportDate]
  );
  useSeo(seo);

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
            {pr.sector && <span className="badge plain">{pr.sector}</span>}
          </div>
        </div>
      </div>

      <AnswerBox text={seo.answer} />

      <GuruSignal ticker={ticker} cusip={cusip} />

      {/* The quote board reads like the one on a finance portal: the chart
          with its own range tabs, then the numbers a reader checks against it.
          It sits directly under the guru signal because that is the order the
          question comes in — who is buying this, and what has the price done. */}
      <div className="card mt16">
        <ChartBox height={300}><PriceChart ticker={ticker} lang={lang} /></ChartBox>
        <div className="kv-grid quote-grid mt16">
          <KV k={t('stock.prevClose')} v={fmtNum(p.prevClose, 2)} />
          <KV k={t('stock.open')} v={fmtNum(p.open, 2)} />
          <KV
            k={t('stock.dayRange')}
            v={p.low != null && p.high != null ? `${fmtNum(p.low, 2)} – ${fmtNum(p.high, 2)}` : '—'}
          />
          <KV
            k={t('stock.range52')}
            v={p.low52 != null && p.high52 != null ? `${fmtNum(p.low52, 2)} – ${fmtNum(p.high52, 2)}` : '—'}
          />
          <KV k={t('stock.volume')} v={fmtNum(p.volume)} />
          <KV k={t('stock.avgVolume')} v={fmtNum(tr.avgVolume)} />
          <KV k={t('stock.mktCap')} v={fmtMoney(p.marketCap)} />
          <KV k={t('stock.beta')} tip="tips.beta" v={fmtRatio(tr.beta)} />
          <KV k={t('stock.trailingPE')} tip="tips.pe" v={fmtRatio(v.trailingPE)} />
          <KV k={t('stock.eps')} tip="tips.eps" v={fmtRatio(f.eps)} />
          <KV k={t('stock.targetMean')} v={fmtNum(an.targetMean, 2)} />
          <KV k={t('stock.divYield')} tip="tips.divYield" v={fmtFracPct(f.dividendYield, { digits: 2 })} />
        </div>
      </div>

      {data.source !== 'quoteSummary' && (
        <div
          className="card"
          style={{ background: 'var(--popover)', borderColor: 'var(--border-strong)', marginBottom: 16 }}
        >
          <span className="small"><Ico icon={TriangleAlert} size={14} /> {t('stock.limitedData')}</span>
        </div>
      )}

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
          <h3><Ico icon={UserRound} /> {t('stock.insiders')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('stock.insDate')}</th>
                  <th className="l">{t('stock.insOwner')}</th>
                  <th className="l">{t('stock.insTitle')}</th>
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
                    <td className="l muted small">{tx.title || '—'}</td>
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
          <p className="muted small mt8">{t('stock.insidersNote')}</p>
        </div>
      )}

      {!isPro && (
        <div className="mt16">
          <Paywall />
        </div>
      )}

      {cusip && isPro && (ownership.isLoading || ownership.data?.holders?.length > 0) && (
        <div className="card mt16">
          <h3><Ico icon={Waves} /> {t('stock.ownership')}</h3>
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
                    {ownership.data.holders.map((h) => (
                      <tr key={h.cik}>
                        <td className="l">
                          <Link to={managerPath(h.cik, h.path)} style={{ fontWeight: 700 }}>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small mt8">{t('stock.ownershipNote')}</p>
            </>
          )}
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
      <Faq items={seo.faq} />
      <Disclaimer />
    </div>
  );
}
