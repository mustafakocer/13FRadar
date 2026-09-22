import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useI18n } from '../i18n.jsx';
import { managerPath } from '../lib/paths.js';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format.js';
import Ico from './Ico.jsx';
import { Users, ArrowUpRight, ArrowDownRight } from 'lucide-react';

// Who among the curated funds owns this security, and what they did with it
// last quarter. Two orderings of the same holder list sit side by side on
// purpose: the biggest position in dollars is usually a large fund's small
// idea, while the biggest position by portfolio weight is somebody's actual
// bet. Reading only the first list is how people mistake index-scale
// ownership for conviction.
export default function GuruOwnership({ stock, byConviction, byValue, truncated, options, ownedPct, universe, trend }) {
  const { t } = useI18n();
  const [range, setRange] = useState('all');
  if (!stock) return null;

  const row = (h, showWeight) => (
    <tr key={`${h.cik}-${showWeight ? 'w' : 'v'}`}>
      <td className="l">
        <Link to={managerPath(h.cik)}>{h.name}</Link>
      </td>
      <td className="num">{showWeight ? fmtPct(h.weight, { sign: false }) : fmtMoney(h.value)}</td>
      <td className="num">
        <span className={h.activity === 'reduce' ? 'delta-neg' : h.activity === 'hold' ? '' : 'delta-pos'}>
          {t(`guru.act.${h.activity}`)}
          {h.change != null && ` ${fmtPct(h.change, { sign: true })}`}
        </span>
      </td>
    </tr>
  );

  const list = (title, rows, showWeight) => (
    <div style={{ flex: '1 1 280px', minWidth: 0 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>{title}</div>
      <div className="table-wrap"><table className="data">
        <tbody>{rows.map((h) => row(h, showWeight))}</tbody>
      </table></div>
    </div>
  );

  return (
    <div className="card mt16">
      <h3><Ico icon={Users} /> {t('guru.ownership')}</h3>

      <div className="kv-grid mt16">
        <div className="kv">
          <span className="k">{t('guru.rank')}</span>
          <span className="v">
            #{fmtNum(stock.rank)}
            {universe ? <span className="small muted"> {t('guru.rankOf').replace('{n}', fmtNum(universe))}</span> : null}
          </span>
        </div>
        <div className="kv">
          <span className="k">{t('guru.holding')}</span>
          <span className="v">{fmtNum(stock.holderCount)}</span>
        </div>
        {ownedPct != null && (
          <div className="kv">
            <span className="k">{t('guru.ownedPct')}</span>
            <span className="v">{fmtPct(ownedPct, { sign: false, digits: 2 })}</span>
          </div>
        )}
        <div className="kv">
          <span className="k">{t('guru.netActivity')}</span>
          <span className={`v ${stock.netValue >= 0 ? 'delta-pos' : 'delta-neg'}`}>
            {stock.netValue >= 0 ? '+' : '−'}
            {fmtMoney(Math.abs(stock.netValue))}
          </span>
        </div>
      </div>

      <div className="small muted mt16">{t('guru.breakdown')}</div>
      <div className="row mt8" style={{ gap: 16, flexWrap: 'wrap' }}>
        <span className="delta-pos">
          <Ico icon={ArrowUpRight} size={14} /> {fmtMoney(stock.buyValue)} · {stock.newBuyers}{' '}
          {t('guru.newBuys')} · {stock.adders} {t('guru.adds')}
        </span>
        <span className="delta-neg">
          <Ico icon={ArrowDownRight} size={14} /> {fmtMoney(stock.sellValue)} · {stock.reducers}{' '}
          {t('guru.reduces')} · {stock.exiters} {t('guru.exits')}
        </span>
        <span className="muted">
          {stock.buyers} {t('guru.netBuyers')} · {stock.sellers} {t('guru.netSellers')}
        </span>
      </div>

      <div className="row mt16" style={{ gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {byConviction?.length > 0 && list(t('guru.byConviction'), byConviction, true)}
        {byValue?.length > 0 && list(t('guru.byValue'), byValue, false)}
      </div>

      {trend?.quarters?.length > 1 && (
        <>
          <div className="row mt16" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div className="small muted">
              {t('guru.trend')}
              {/* the history covers the funds it can backfill, which is fewer
                  than the panel — saying which keeps the count honest */}
              <span> · {t('guru.trendFunds').replace('{n}', fmtNum(trend.funds))}</span>
            </div>
            <div className="row" style={{ gap: 4 }}>
              {['1y', '5y', '10y', 'all'].map((r) => (
                <button key={r} className={`chip sm${range === r ? ' fsel-active' : ''}`} onClick={() => setRange(r)}>
                  {t(`guru.range.${r}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap"><table className="data mt8">
            <thead>
              <tr>
                <th className="l">{t('filings.reportFor')}</th>
                <th>{t('guru.holding')}</th>
                <th>{t('consensus.totalValue')}</th>
                <th>{t('consensus.avgWeight')}</th>
              </tr>
            </thead>
            <tbody>
              {cut(trend.quarters, range).map((q) => (
                <tr key={q.reportDate}>
                  <td className="l">{q.reportDate}</td>
                  <td className="num">{fmtNum(q.holders)}</td>
                  <td className="num">{fmtMoney(q.value)}</td>
                  <td className="num">{fmtPct(q.avgWeight, { sign: false })}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}

      {truncated && (
        <div className="small muted mt8">
          <Link to="/pricing">{t('guru.moreHolders')} →</Link>
        </div>
      )}

      {options?.length > 0 && (
        <>
          <div className="small muted mt16">{t('guru.options')}</div>
          <div className="table-wrap"><table className="data mt8">
            <tbody>
              {options.map((o) => (
                <tr key={`${o.cusip}-${o.putCall}`}>
                  <td className="l">
                    <span className={`badge ${o.putCall === 'Put' ? 'neg' : 'pos'}`}>{o.putCall}</span>
                  </td>
                  <td className="num">{fmtMoney(o.totalValue)}</td>
                  <td className="num">{fmtNum(o.holderCount)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

// The server sends the whole stored history; the range buttons cut it here so
// switching windows costs nothing and works before hydration finishes.
const RANGE_QUARTERS = { '1y': 4, '5y': 20, '10y': 40 };
function cut(quarters, range) {
  const n = RANGE_QUARTERS[range];
  return n ? quarters.slice(-n) : quarters;
}
