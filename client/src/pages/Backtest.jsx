import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { api } from '../lib/api.js';
import { fmtPct, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { getVar, tooltipStyle } from '../components/Charts/chartUtils.js';
import SearchBox from '../components/SearchBox.jsx';
import Paywall from '../components/Paywall.jsx';

function quarterEnds(n) {
  const out = [];
  const d = new Date();
  let y = d.getUTCFullYear();
  let q = Math.floor(d.getUTCMonth() / 3); // current quarter index 0..3; last completed = q-1
  for (let i = 0; i < n; i++) {
    q--;
    if (q < 0) {
      q = 3;
      y--;
    }
    out.push(`${y}-${String((q + 1) * 3).padStart(2, '0')}-${[31, 30, 30, 31][q]}`);
  }
  return out;
}
const pctR = (x, d = 1) => (x == null ? '—' : fmtPct(x * 100, { digits: d }));

export default function Backtest() {
  const { t } = useI18n();
  const { isPro } = useAuth();
  usePageTitle(`${t('bt.title')} — 13F Radar`);
  const starts = quarterEnds(24);
  const [funds, setFunds] = useState([]);
  const [start, setStart] = useState(starts[11]);
  const [weighting, setWeighting] = useState('aum');
  const [top, setTop] = useState(25);
  const [params, setParams] = useState(null);
  const q = useQuery({
    queryKey: ['backtest', params],
    queryFn: () => api.backtest(params.ciks, params.start, params.weighting, params.top),
    enabled: !!params,
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  const d = q.data;
  const chart = d?.curve?.map((p) => ({ date: p.date, fund: Number(((p.value - 1) * 100).toFixed(2)), spy: p.bench != null ? Number(((p.bench - 1) * 100).toFixed(2)) : null })) || [];
  if (chart.length && d?.start) chart.unshift({ date: d.start, fund: 0, spy: 0 });

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>⏪ {t('bt.title')}</h1>
          <div className="sub">{t('bt.subtitle')}</div>
        </div>
      </div>
      {!isPro ? (
        <Paywall />
      ) : (
        <div className="card">
          <div className="row" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
            {funds.map((f) => (
              <span key={f.cik} className="badge plain">{f.name} <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }} onClick={() => setFunds(funds.filter((x) => x.cik !== f.cik))}>✕</button></span>
            ))}
            {funds.length < 5 && <span style={{ minWidth: 240 }}><SearchBox small placeholder={t('bt.addFund')} onSelect={(m) => !funds.some((x) => x.cik === m.cik) && setFunds([...funds, m])} /></span>}
          </div>
          <div className="row mt8" style={{ flexWrap: 'wrap' }}>
            <label className="small">{t('bt.start')} <select className="select" value={start} onChange={(e) => setStart(e.target.value)}>{starts.map((s) => <option key={s} value={s}>{quarterLabel(s)}</option>)}</select></label>
            {funds.length > 1 && (
              <label className="small">{t('groups.weighting.aum')}/{t('groups.weighting.equal')} <select className="select" value={weighting} onChange={(e) => setWeighting(e.target.value)}><option value="aum">{t('groups.weighting.aum')}</option><option value="equal">{t('groups.weighting.equal')}</option></select></label>
            )}
            <label className="small">{t('bt.top')} <select className="select" value={top} onChange={(e) => setTop(Number(e.target.value))}>{[10, 15, 25, 40, 50].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <button className="btn" disabled={!funds.length || q.isFetching} onClick={() => setParams({ ciks: funds.map((f) => f.cik), start, weighting, top })}>{q.isFetching ? '…' : t('bt.run')}</button>
          </div>
          <p className="muted small mt8">{t('bt.assumption')}</p>
        </div>
      )}
      {q.error && <div className="error-box mt16">{t('common.error')}: {String(q.error.message)}</div>}
      {d && (
        <>
          <div className="grid grid-4 mt16">
            {[
              ['bt.total', d.total, d.benchTotal],
              ['bt.cagr', d.cagr, d.benchCagr],
              ['bt.mdd', d.maxDrawdown, d.benchMaxDrawdown],
              ['bt.coverage', d.coverage, null],
            ].map(([k, a, b]) => (
              <div className="card stat-card" key={k}>
                <span className="stat-label">{t(k)}</span>
                <span className={`stat-value ${a > 0 ? 'delta-pos' : a < 0 ? 'delta-neg' : ''}`}>{k === 'bt.coverage' ? `${Math.round((a || 0) * 100)}%` : pctR(a)}</span>
                {b != null && <span className="stat-sub">S&P 500: {pctR(b)}</span>}
                {k === 'bt.coverage' && <span className="stat-sub">{d.priced}/{d.symbols} {t('bt.symbolsPriced')} · {d.priceSource}</span>}
              </div>
            ))}
          </div>
          <div className="card mt16">
            <h3>{t('bt.curve')} · {quarterLabel(d.params.start)} → {d.end} · {d.years} {t('bt.years')} · {d.quarters} {t('bt.quarters')}</h3>
            <div style={{ height: 300 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={getVar('--grid')} vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: getVar('--muted'), fontSize: 11 }} tickLine={false} axisLine={{ stroke: getVar('--border') }} minTickGap={40} />
                  <YAxis tickFormatter={(v) => `${v}%`} tick={{ fill: getVar('--muted'), fontSize: 11 }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip contentStyle={tooltipStyle()} formatter={(v, k) => [`${v}%`, k === 'fund' ? t('bt.portfolio') : 'S&P 500 (SPY)']} />
                  <Legend formatter={(k) => (k === 'fund' ? t('bt.portfolio') : 'S&P 500 (SPY)')} />
                  <Line type="monotone" dataKey="fund" stroke={getVar('--s1')} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="spy" stroke={getVar('--muted')} strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="table-wrap mt16">
              <table className="data">
                <thead><tr><th className="l">{t('screen.quarter')}</th><th className="l">{t('bt.holdFrom')}</th><th className="l">{t('bt.holdTo')}</th><th>{t('bt.portfolio')}</th><th>SPY</th><th>{t('bt.coverage')}</th></tr></thead>
                <tbody>
                  {d.series.map((s) => (
                    <tr key={s.reportDate}>
                      <td className="l">{quarterLabel(s.reportDate)}</td>
                      <td className="l muted">{s.from}</td>
                      <td className="l muted">{s.to}</td>
                      <td className={`num ${s.ret > 0 ? 'delta-pos' : s.ret < 0 ? 'delta-neg' : ''}`}>{pctR(s.ret, 2)}</td>
                      <td className="num">{pctR(s.bench, 2)}</td>
                      <td className="num">{Math.round(s.coverage * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small mt8">{t('bt.note')} <Link to="/performance">{t('nav.performance')}</Link></p>
          </div>
        </>
      )}
    </div>
  );
}
