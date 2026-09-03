import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtPct, fmtNum } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import HoldingsTreemap from './Charts/HoldingsTreemap.jsx';
import Paywall from './Paywall.jsx';
import ExportButtons from './ExportButtons.jsx';

const Sym = ({ r }) => (r.ticker ? <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }}>{r.ticker}</Link> : <span className="muted small">{r.cusip}</span>);

// Combined "super fund" portfolio for a set of managers.
export default function GroupPortfolio({ ciks, weighting: initial = 'aum' }) {
  const { t } = useI18n();
  const [weighting, setWeighting] = useState(initial);
  const returns = useStaticReturns();
  const q = useQuery({
    queryKey: ['group-portfolio', [...ciks].sort().join(','), weighting],
    queryFn: () => api.groupPortfolio(ciks, weighting),
    enabled: ciks.length > 0,
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  if (!ciks.length) return <div className="muted small">{t('groups.noMembers')}</div>;
  if (q.isLoading) return <div className="loading"><div className="spinner" />{t('common.loading')}</div>;
  if (q.error?.status === 402) return <Paywall compact />;
  if (q.error) return <div className="error-box">{t('common.error')}: {String(q.error.message)}</div>;
  const d = q.data;
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div className="head-badges">
          <span className="badge plain">{t('manager.aum')}: <b>{fmtMoney(d.totalAum)}</b></span>
          <span className="badge plain">{t('groups.fundCount')}: <b>{d.funds.length}</b></span>
          <span className="badge plain">{t('manager.positions')}: <b>{d.positions.length}</b></span>
        </div>
        <span className="row" style={{ gap: 8 }}><ExportButtons name="group_portfolio" rows={() => d.positions.map((p) => ({ ticker: p.ticker, cusip: p.cusip, issuer: p.issuer, weight: p.weight, value: p.value, holders: p.holderCount }))} compact /><div className="seg">
          {['aum', 'equal'].map((w) => (
            <button key={w} className={weighting === w ? 'active' : ''} onClick={() => setWeighting(w)}>{t(`groups.weighting.${w}`)}</button>
          ))}
        </div></span>
      </div>
      <div className="head-badges mt8">
        {d.funds.map((f) => (
          <Link key={f.cik} to={`/manager/${f.cik}`} className="badge plain">{f.name} · {fmtPct(f.share * 100, { sign: false, digits: 0 })}</Link>
        ))}
      </div>
      <div className="mt16">
        <HoldingsTreemap positions={d.positions} returns={returns.data} labels={{ weight: t('table.weight'), ret: t('table.retYtd') }} />
      </div>
      <div className="table-wrap mt16">
        <table className="data">
          <thead>
            <tr>
              <th className="l">#</th>
              <th className="l">{t('table.symbol')}</th>
              <th className="l">{t('table.company')}</th>
              <th>{t('table.weight')}</th>
              <th>{t('table.value')}</th>
              <th>{t('groups.holders')}</th>
            </tr>
          </thead>
          <tbody>
            {d.positions.slice(0, 50).map((p, i) => (
              <tr key={p.cusip}>
                <td className="l muted">{i + 1}</td>
                <td className="l"><Sym r={p} /></td>
                <td className="l" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.issuer}</td>
                <td className="num">{fmtPct(p.weight, { sign: false, digits: 2 })}</td>
                <td className="num">{fmtMoney(p.value)}</td>
                <td className="num" title={p.holders.map((h) => `${h.name} ${fmtPct(h.weight, { sign: false })}`).join(' · ')}>{fmtNum(p.holderCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-2 mt16">
        {[['NEW', 'pos'], ['ADD', 'pos'], ['REDUCE', 'neg'], ['EXIT', 'neg']].map(([k, cls]) => (
          <div className="card pos-col" key={k}>
            <h3>{t(`timeline.action.${k}`)} ({d.trades[k].length})</h3>
            {!d.trades[k].length && <div className="muted small">{t('common.na')}</div>}
            {d.trades[k].slice(0, 12).map((r) => (
              <div className="pos-row" key={r.cusip}>
                <div style={{ minWidth: 0 }}>
                  <div className="tick"><Sym r={r} /></div>
                  <div className="issuer">{r.issuer}</div>
                </div>
                <div className="right small">
                  <span className={`badge ${cls}`}>{r.funds.length} {t('groups.fundsShort')}</span>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="muted small mt8">{t('groups.methodNote')}</p>
    </div>
  );
}
