import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtMoney, fmtPct, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { usePerformance } from '../hooks/usePerformance.js';
import Paywall from '../components/Paywall.jsx';
import ExportButtons from '../components/ExportButtons.jsx';

const COLS = [
  ['name', 'perf.fund', true],
  ['score', 'perf.score'],
  ['ret1y', 'perf.ret1y'],
  ['ret3y', 'perf.ret3y'],
  ['alpha1y', 'perf.alpha1y'],
  ['turnover', 'perf.turnover'],
  ['top10', 'perf.top10'],
  ['aum', 'manager.aum'],
  ['aumTrend1y', 'perf.aumTrend'],
];
const FREE_ROWS = 20;
const pctR = (x, d = 1) => (x == null ? '—' : fmtPct(x * 100, { digits: d }));

export default function Performance() {
  const { t } = useI18n();
  const { isPro } = useAuth();
  usePageTitle(`${t('perf.title')} — 13F Radar`);
  const perf = usePerformance();
  const [sort, setSort] = useState({ key: 'score', dir: -1 });
  const [open, setOpen] = useState(null);

  const rows = useMemo(() => {
    const list = (perf.data?.funds || []).map((f) => ({ ...f, alpha1y: f.ret1y != null && f.spy1y != null ? f.ret1y - f.spy1y : null }));
    const { key, dir } = sort;
    return [...list].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return typeof av === 'string' ? av.localeCompare(bv) * dir : (av - bv) * dir;
    });
  }, [perf.data, sort]);
  const visible = isPro ? rows : rows.slice(0, FREE_ROWS);
  const onSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'name' ? 1 : -1 }));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏆 {t('perf.title')}</h1>
          <div className="sub">{t('perf.subtitle')}</div>
        </div>
      </div>
      {perf.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {perf.error && <div className="card muted">{t('perf.noData')}</div>}
      {perf.data && (
        <>
          <div className="card">
            <div className="head-badges">
              <span className="badge plain">{t('perf.updated')}: {perf.data.updatedAt?.slice(0, 10)}</span>
              <span className="badge plain">{t('perf.priceSource')}: {perf.data.priceSource}</span>
              <span className="badge plain">{t('perf.benchmark')}: {perf.data.benchmark}</span>
              <span className="badge plain">{rows.length} {t('perf.funds')}</span>
              <ExportButtons name="fund_performance" rows={() => rows.map((f) => ({ cik: f.cik, name: f.name, score: f.score, ret1y: f.ret1y, ret3y: f.ret3y, spy1y: f.spy1y, spy3y: f.spy3y, turnover: f.turnover, top10: f.top10, aum: f.aum, aumTrend1y: f.aumTrend1y, coverage: f.coverage }))} compact />
            </div>
            {!isPro && <p className="muted small mt8">{t('perf.freeNote', { n: FREE_ROWS })} <Link to="/pricing">{t('paywall.cta')}</Link></p>}
            <div className="table-wrap mt8">
              <table className="data">
                <thead>
                  <tr>
                    <th className="l">#</th>
                    {COLS.map(([k, tk, left]) => (
                      <th key={k} className={left ? 'l' : ''} onClick={() => onSort(k)}>{t(tk)}{sort.key === k ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((f, i) => [
                    <tr key={f.cik} onClick={() => setOpen(open === f.cik ? null : f.cik)} style={{ cursor: 'pointer' }}>
                      <td className="l muted">{i + 1}</td>
                      <td className="l"><Link to={`/manager/${f.cik}`} style={{ fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>{f.name}</Link></td>
                      <td className="num">{f.score != null ? <span className={`badge ${f.score >= 67 ? 'pos' : f.score <= 33 ? 'neg' : 'plain'}`}>{f.score}</span> : '—'}</td>
                      <td className={`num ${f.ret1y > 0 ? 'delta-pos' : f.ret1y < 0 ? 'delta-neg' : ''}`}>{pctR(f.ret1y)}</td>
                      <td className={`num ${f.ret3y > 0 ? 'delta-pos' : f.ret3y < 0 ? 'delta-neg' : ''}`}>{pctR(f.ret3y)}</td>
                      <td className={`num ${f.alpha1y > 0 ? 'delta-pos' : f.alpha1y < 0 ? 'delta-neg' : ''}`}>{pctR(f.alpha1y)}</td>
                      <td className="num">{f.turnover != null ? fmtPct(f.turnover, { sign: false, digits: 0 }) : '—'}</td>
                      <td className="num">{fmtPct(f.top10, { sign: false, digits: 0 })}</td>
                      <td className="num">{fmtMoney(f.aum)}</td>
                      <td className={`num ${f.aumTrend1y > 0 ? 'delta-pos' : f.aumTrend1y < 0 ? 'delta-neg' : ''}`}>{pctR(f.aumTrend1y, 0)}</td>
                    </tr>,
                    open === f.cik ? (
                      <tr key={`${f.cik}-q`}>
                        <td colSpan={COLS.length + 1} className="l" style={{ background: 'var(--surface-2)' }}>
                          {isPro ? (
                            <div className="timeline-badges">
                              {f.quarters.map((q) => (
                                <div key={q.reportDate} className="timeline-q">
                                  <div className="muted small">{quarterLabel(q.reportDate)}</div>
                                  <div className={q.ret > 0 ? 'delta-pos' : q.ret < 0 ? 'delta-neg' : ''}><b>{pctR(q.ret)}</b></div>
                                  <div className="muted small">SPY {pctR(q.bench)}</div>
                                  <div className="muted small">{t('perf.coverage')} {Math.round(q.coverage * 100)}%</div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <Paywall compact />
                          )}
                        </td>
                      </tr>
                    ) : null,
                  ])}
                </tbody>
              </table>
            </div>
            {!isPro && rows.length > FREE_ROWS && <div className="mt16"><Paywall compact /></div>}
          </div>
          <div className="card mt16">
            <h3>📐 {t('perf.methodTitle')}</h3>
            <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.7 }}>
              <li>{t('perf.method1')}</li>
              <li>{t('perf.method2')}</li>
              <li>{t('perf.method3')}</li>
              <li>{t('perf.method4')}</li>
              <li>{t('perf.method5')}</li>
            </ol>
            <p className="muted small">{t('perf.methodCaveat')}</p>
          </div>
        </>
      )}
    </div>
  );
}
