import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  fmtMoney,
  fmtNum,
  fmtPct,
  fmtFracPct,
  fmtRatio,
  deltaClass,
} from '../lib/format.js';
import { useI18n } from '../i18n.jsx';

function KV({ k, v, cls = '' }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
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
  const { t } = useI18n();

  const { data, isLoading, error } = useQuery({
    queryKey: ['stock', ticker],
    queryFn: () => api.stock(ticker),
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

  const { price: p = {}, valuation: v = {}, fundamentals: f = {}, profile: pr = {} } = data;
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
          <KV k={t('stock.eps')} v={fmtRatio(f.eps)} />
        </div>
      </div>

      <div className="grid grid-2 mt16">
        <div className="card">
          <h3>{t('stock.valuation')}</h3>
          <KV k={t('stock.trailingPE')} v={fmtRatio(v.trailingPE)} />
          <KV k={t('stock.forwardPE')} v={fmtRatio(v.forwardPE)} />
          <KV k={t('stock.peg')} v={fmtRatio(v.peg)} />
          <KV k={t('stock.ps')} v={fmtRatio(v.priceToSales)} />
          <KV k={t('stock.pb')} v={fmtRatio(v.priceToBook)} />
          <KV k={t('stock.evEbitda')} v={fmtRatio(v.evToEbitda)} />
          <KV k={t('stock.evRevenue')} v={fmtRatio(v.evToRevenue)} />
        </div>
        <div className="card">
          <h3>{t('stock.fundamentals')}</h3>
          <KV k={t('stock.revenue')} v={fmtMoney(f.revenue)} />
          <KV
            k={t('stock.revenueGrowth')}
            v={fmtFracPct(f.revenueGrowth)}
            cls={deltaClass(f.revenueGrowth)}
          />
          <KV k={t('stock.grossMargin')} v={fmtFracPct(f.grossMargin)} />
          <KV k={t('stock.operatingMargin')} v={fmtFracPct(f.operatingMargin)} />
          <KV k={t('stock.profitMargin')} v={fmtFracPct(f.profitMargin)} />
          <KV k={t('stock.roe')} v={fmtFracPct(f.roe)} />
          <KV k={t('stock.roa')} v={fmtFracPct(f.roa)} />
          <KV k={t('stock.debtEquity')} v={fmtRatio(f.debtToEquity)} />
          <KV k={t('stock.fcf')} v={fmtMoney(f.freeCashflow)} />
          <KV k={t('stock.divYield')} v={fmtFracPct(f.dividendYield, { digits: 2 })} />
          <KV k={t('stock.beta')} v={fmtRatio(f.beta)} />
          <KV k={t('stock.shortRatio')} v={fmtRatio(f.shortRatio)} />
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
