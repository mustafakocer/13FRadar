import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { getVar, tooltipStyle } from '../components/Charts/chartUtils.js';
import Paywall from '../components/Paywall.jsx';

const FREE_ROWS = 10;
const ACTION_CLASS = { NEW: 'pos', ADD: 'pos', REDUCE: 'neg', EXIT: 'neg', HOLD: 'plain' };

function History({ history, t }) {
  if (!history?.length) return null;
  const data = history.map((h) => ({ q: quarterLabel(h.period), value: h.value, funds: h.funds }));
  return (
    <div style={{ height: 180 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={getVar('--grid')} vertical={false} />
          <XAxis dataKey="q" tick={{ fill: getVar('--muted'), fontSize: 11 }} axisLine={{ stroke: getVar('--border') }} tickLine={false} />
          <YAxis tickFormatter={(v) => fmtMoney(v)} tick={{ fill: getVar('--muted'), fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
          <Tooltip contentStyle={tooltipStyle()} formatter={(v, k) => (k === 'value' ? [fmtMoney(v), t('turkiye.value')] : [v, t('turkiye.funds')])} cursor={{ fill: getVar('--muted'), fillOpacity: 0.1 }} />
          <Bar dataKey="value" fill={getVar('--s1')} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Turkiye() {
  const { t, lang } = useI18n();
  const { isPro } = useAuth();
  usePageTitle(`${t('turkiye.title')} — 13F Radar`);
  const q = useQuery({ queryKey: ['turkey'], queryFn: () => api.turkey(), staleTime: 30 * 60 * 1000, retry: 0 });
  const secs = q.data?.securities || [];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🇹🇷 {t('turkiye.title')}</h1>
          <div className="sub">{t('turkiye.subtitle')}</div>
        </div>
      </div>
      {q.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {(q.error || (q.data && !secs.length)) && <div className="card muted">{t('turkiye.noData')}</div>}
      {secs.map((s) => {
        const holders = s.holders.filter((h) => h.value > 0 || h.action === 'EXIT');
        const visible = isPro ? holders : holders.slice(0, FREE_ROWS);
        return (
          <div className="card mt16" key={s.cusip}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>
                <Link to={`/stock/${s.ticker}?cusip=${s.cusip}`}>{s.ticker}</Link> · {s.name}
              </h3>
              <span className="muted small">{quarterLabel(s.period)}</span>
            </div>
            <div className="head-badges mt8">
              <span className="badge plain">{t('turkiye.funds')}: <b>{fmtNum(s.funds)}</b></span>
              <span className="badge plain">{t('turkiye.value')}: <b>{fmtMoney(s.value)}</b></span>
              {s.diffFunds > 0 && (
                <>
                  <span className="badge pos">{t('turkiye.adding')} {s.adding}</span>
                  <span className="badge neg">{t('turkiye.reducing')} {s.reducing}</span>
                  <span className="badge plain">{t('turkiye.new')} {s.newCount} · {t('turkiye.exit')} {s.exitCount}</span>
                  <span className={`badge ${s.netFlow > 0 ? 'pos' : s.netFlow < 0 ? 'neg' : 'plain'}`}>{t('turkiye.netFlow')}: {(s.netFlow > 0 ? '+' : '') + fmtMoney(s.netFlow)}</span>
                </>
              )}
            </div>
            {lang === 'tr' && s.narrative && (
              <div className="mt16" style={{ padding: '12px 14px', borderLeft: '3px solid var(--s1)', background: 'var(--surface-2)', borderRadius: 8 }}>
                <div className="stat-label" style={{ marginBottom: 4 }}>{t('turkiye.summary')}</div>
                <p style={{ margin: 0, lineHeight: 1.6 }}>{s.narrative}</p>
              </div>
            )}
            {s.history?.length > 1 && (
              <div className="mt16">
                <div className="stat-label" style={{ marginBottom: 6 }}>{t('turkiye.history')}</div>
                <History history={s.history} t={t} />
              </div>
            )}
            <div className="table-wrap mt16">
              <table className="data">
                <thead>
                  <tr>
                    <th className="l">{t('turkiye.holder')}</th>
                    <th>{t('table.value')}</th>
                    <th>{t('table.shares')}</th>
                    <th>{t('table.weight')}</th>
                    <th>{t('turkiye.dShares')}</th>
                    <th>{t('turkiye.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((h) => (
                    <tr key={h.cik}>
                      <td className="l"><Link to={`/manager/${h.cik}`} style={{ fontWeight: 700 }}>{h.name}</Link></td>
                      <td className="num">{h.value ? fmtMoney(h.value) : <span className="muted">({fmtMoney(h.prevValue)})</span>}</td>
                      <td className="num">{fmtNum(h.shares)}</td>
                      <td className="num">{h.weight ? fmtPct(h.weight, { sign: false, digits: 2 }) : '—'}</td>
                      <td className={`num ${h.dShares > 0 ? 'delta-pos' : h.dShares < 0 ? 'delta-neg' : ''}`}>{h.dShares != null ? (h.dShares > 0 ? '+' : '') + fmtNum(h.dShares) : '—'}</td>
                      <td>{h.action ? <span className={`badge ${ACTION_CLASS[h.action]}`}>{t(`timeline.action.${h.action}`)}</span> : <span className="muted small">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isPro && holders.length > FREE_ROWS && (
              <div className="mt8">
                <p className="muted small">{t('turkiye.freeNote', { n: FREE_ROWS })} <Link to="/pricing">{t('paywall.cta')}</Link></p>
                <Paywall compact />
              </div>
            )}
          </div>
        );
      })}
      {secs.length > 0 && <p className="muted small mt16">{t('turkiye.note', { list: secs.map((s) => `${s.ticker} (${s.name})`).join(', ') })}</p>}
    </div>
  );
}
