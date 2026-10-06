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
  fmtLocal,
  fmtOffPct,
} from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import Paywall from '../components/Paywall.jsx';
import ChartBox from '../components/ChartBox.jsx';
import { PriceChart } from '../components/Charts/index.js';
import GuruSignal from '../components/GuruSignal.jsx';
import GuruOwnership from '../components/GuruOwnership.jsx';
import { useGuruStock } from '../hooks/useGuruStock.js';
import InfoTip from '../components/InfoTip.jsx';
import { managerPath } from '../lib/paths.js';
import Ico from '../components/Ico.jsx';
import { TriangleAlert, UserRound, Waves } from 'lucide-react';
import TickerLogo from '../components/TickerLogo.jsx';
import PerfStrip from '../components/PerfStrip.jsx';

function KV({ k, v, cls = '', tip, src = null, title = null }) {
  return (
    <div className="kv">
      <span className="k">
        {k}
        {tip && <InfoTip tip={tip} />}
      </span>
      <span className={`v ${cls}`} title={title || undefined}>{v}</span>
      {src}
    </div>
  );
}

// "SEC 10-Q, 30.06.2026" under a fundamentals figure, linking to the filing
// it was read from (api/_lib/secFundamentals.js); a foreign filer's figure
// says what it was converted from.
function SecSource({ s, t, lang }) {
  if (!s?.form) return null;
  const d = s.end ? new Date(`${s.end}T00:00:00Z`).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : '';
  const extra = [s.basis === 'annual' ? t('sec.annual') : null, s.currency ? t('sec.converted').replace('{cur}', s.currency) : null, s.perAds ? t('sec.perAds').replace('{n}', s.perAds) : null].filter(Boolean).join(' · ');
  const label = `SEC ${s.form}, ${d}${extra ? ` · ${extra}` : ''}`;
  return (
    <span className="sec-src small muted" data-sec-source>
      {s.url ? (
        <a href={s.url} target="_blank" rel="noopener noreferrer">{label}</a>
      ) : (
        label
      )}
    </span>
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

  // The quote. The endpoint answers 200 with a dated or empty price block
  // when its providers are down (priceStale / priceUnavailable), so this
  // query only errors on a network failure or the client-side deadline —
  // and then the page still renders everything that does not need a quote.
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['stock', ticker],
    queryFn: () => api.stock(ticker),
    retry: 1,
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

  // Per-security standing among the curated funds — covers every name they
  // hold, not just the thirty that fit on the consensus page.
  const guru = useGuruStock({ ticker, cusip });

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

  // Every field below is read defensively: a fallback payload carries nulls,
  // and a failed request carries nothing at all.
  const p = data?.price || {};
  const tr = data?.trading || {};
  const sec = data?.sec || {};
  const pr = data?.profile || {};
  const chg = p.changePercent;
  const sym = p.symbol || String(ticker || '').toUpperCase();
  const quoteMissing = !!error || !data || data.priceUnavailable || p.price == null;
  const quoteStale = !quoteMissing && !!(data.priceStale || data.stale);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>
            <TickerLogo ticker={sym} size={40} /> {p.name || sym} <span className="muted" style={{ fontWeight: 600 }}>({sym})</span>
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
            {quoteStale && data.priceAsOf && (
              <span className="badge plain" title={t('stock.priceStale')}>{t('stock.asOf')} {data.priceAsOf}</span>
            )}
            {pr.sector && <span className="badge plain">{pr.sector}</span>}
          </div>
          <PerfStrip ticker={sym} />
        </div>
      </div>

      {/* The quote is one provider among several on this page. When it is
          missing the page says so here and carries on: the ownership block,
          the FAQ and the links below do not depend on it. */}
      {(quoteMissing || quoteStale) && (
        <div className="card" style={{ background: 'var(--popover)', borderColor: 'var(--border-strong)', marginBottom: 16 }} role="status">
          <span className="small">
            <Ico icon={TriangleAlert} size={14} />{' '}
            {quoteMissing ? t('stock.priceUnavailable') : t('stock.priceStale')}
            {error && <span className="muted"> · {String(error.message)}</span>}
          </span>
          {error && (
            <button className="btn ghost sm" style={{ marginLeft: 12 }} onClick={() => refetch()}>
              {t('common.retry')}
            </button>
          )}
        </div>
      )}

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
          {/* fundamentals: SEC filings (api/_lib/secFundamentals.js), priced
              at this page's price; a figure that is not there stays "—" */}
          <KV k={t('stock.mktCap')} v={fmtMoney(sec.marketCap ?? p.marketCap)} src={<SecSource s={sec.src?.shares} t={t} lang={lang} />} />
          <KV k={t('stock.beta')} tip="tips.beta" v={fmtRatio(sec.beta ?? null)} src={sec.beta != null ? <span className="sec-src small muted">{t('sec.betaBasis')}</span> : null} />
          <KV k={t('stock.trailingPE')} tip="tips.pe" v={sec.pe === 'loss' ? t('stock.loss') : fmtRatio(sec.pe ?? null)} cls={sec.pe === 'loss' ? 'delta-neg' : ''} src={<SecSource s={sec.src?.eps} t={t} lang={lang} />} />
          <KV k={t('stock.eps')} tip="tips.eps" v={sec.eps != null ? fmtNum(sec.eps, 2) : '—'} title={sec.epsReason} src={<SecSource s={sec.src?.eps} t={t} lang={lang} />} />
          <KV k={t('stock.divYield')} tip="tips.divYield" v={sec.dividendYield != null ? fmtFracPct(sec.dividendYield, { digits: 2 }) : '—'} src={<SecSource s={sec.src?.div} t={t} lang={lang} />} />
        </div>
      </div>

      <YearTable
        title={t('stock.income')}
        rows={data?.income}
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
        rows={data?.balance}
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
        rows={data?.cashflow}
        t={t}
        cols={[
          ['operating', 'stock.opCf'],
          ['investing', 'stock.invCf'],
          ['financing', 'stock.finCf'],
          ['capex', 'stock.capex'],
        ]}
      />

      {data?.earnings?.length > 0 && (
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
                      {/* the kind of transaction, not "Alım (M)": an option
                          exercise is not a purchase, a tax withholding is not
                          a sale (api/_lib/insiderClassify.js) */}
                      {tx.category ? (
                        <span
                          className={`badge ${tx.category === 'open_buy' ? 'pos' : tx.category === 'open_sell' ? 'neg' : 'plain'}`}
                          title={tx.code ? `Form 4: ${tx.code}` : undefined}
                        >
                          {t(tx.category === 'preferred' || tx.category === 'other_security' ? `ins.cat.${tx.category}.${tx.side === 'sell' ? 'sell' : 'buy'}` : `ins.cat.${tx.category}`)}
                        </span>
                      ) : (
                        tx.code || '—'
                      )}
                      {tx.compensationNote && (
                        <div className="muted small" data-compensation="1" title={tx.compensationNote}>
                          {t('ins.compensationWhy').replace('{code}', tx.code || 'P')}
                        </div>
                      )}
                    </td>
                    <td className="num">{fmtNum(tx.shares)}</td>
                    <td className="num">{tx.valueUnverified ? `${tx.currency || '?'} ${fmtNum(tx.localPrice, 2)}` : fmtNum(tx.price, 2)}</td>
                    <td className="num">
                      {tx.valueUnverified ? (
                        <>
                          {fmtLocal(tx.currency, tx.localValue)}
                          <div className="muted small">{t('ins.fxUnverified')}</div>
                        </>
                      ) : (
                        <>
                          {fmtMoney(tx.value)}
                          {tx.currency && <div className="muted small">{t('ins.fxConverted').replace('{cu}', tx.currency)}</div>}
                          {tx.offMarket != null && (
                            <div className="muted small" data-off-market={tx.offMarket} title={t('ins.offMarketTip')}>
                              {t('ins.offMarket').replace('{pct}', fmtOffPct(tx.offMarket, lang))}
                            </div>
                          )}
                        </>
                      )}
                    </td>
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

      {guru.held && (
        <GuruOwnership
          stock={guru.stock}
          byConviction={guru.topByConviction}
          byValue={guru.topByValue}
          truncated={guru.holdersTruncated}
          options={guru.options}
          ownedPct={
            guru.stock?.totalShares && tr.sharesOutstanding
              ? (guru.stock.totalShares / tr.sharesOutstanding) * 100
              : null
          }
          universe={guru.universe}
          trend={guru.trend}
        />
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
