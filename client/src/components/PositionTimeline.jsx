import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { getVar, tooltipStyle } from './Charts/chartUtils.js';

const METRICS = ['weight', 'value', 'shares'];
const ACTION_CLASS = { NEW: 'pos', ADD: 'pos', REDUCE: 'neg', EXIT: 'neg', HOLD: 'plain', START: 'plain', NONE: 'plain' };

const fmtAxis = (metric) =>
  metric === 'weight'
    ? (v) => fmtPct(v, { sign: false, digits: 0 })
    : metric === 'value'
      ? (v) => fmtMoney(v)
      : (v) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(0)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v));

const fmtFor = (metric) =>
  metric === 'weight'
    ? (v) => fmtPct(v, { sign: false, digits: 2 })
    : metric === 'value'
      ? (v) => fmtMoney(v)
      : (v) => fmtNum(v);

function TipBox({ active, payload, metric, t }) {
  if (!active || !payload?.length) return null;
  const q = payload[0].payload;
  return (
    <div style={{ ...tooltipStyle(), padding: '8px 12px' }}>
      <div style={{ fontWeight: 700 }}>{quarterLabel(q.reportDate)}</div>
      {!q.filed ? (
        <div className="muted small">{t('timeline.notFiled')}</div>
      ) : (
        <>
          <div>
            {t(`timeline.metric.${metric}`)}: <b>{q.held ? fmtFor(metric)(q[metric]) : '—'}</b>
          </div>
          <div>
            <span className={`badge ${ACTION_CLASS[q.action]}`}>{t(`timeline.action.${q.action}`)}</span>
            {q.dShares != null && q.action !== 'NEW' && q.action !== 'EXIT' && q.dShares !== 0 && (
              <span className="muted small"> {fmtNum(q.dShares)} ({fmtPct(q.dSharesPct)})</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Timeline of one security inside one manager's portfolio.
export default function PositionTimeline({ cik, cusip, limit }) {
  const { t } = useI18n();
  const { isPro } = useAuth();
  const [metric, setMetric] = useState('weight');
  const { data, isLoading, error } = useQuery({
    queryKey: ['poshist2', cik, cusip, limit ?? null],
    queryFn: () => api.positionHistory(cik, cusip, limit ? { limit } : {}),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  if (isLoading) return <div className="muted small">{t('common.loading')}</div>;
  if (error) return <div className="muted small">{t('common.error')}: {String(error.message)}</div>;
  const quarters = data?.quarters || [];
  if (!quarters.some((q) => q.held)) return <div className="muted small">{t('common.na')}</div>;

  const held = quarters.filter((q) => q.held).length;
  const posC = getVar('--s1');
  const mutC = getVar('--muted');
  const chartData = quarters.map((q) => ({ ...q, y: q.held ? q[metric] : 0 }));

  return (
    <div className="timeline">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div className="small">
          <b>{held}</b> {t('poshist.quarters')}
          {data.truncated && (
            <span className="muted"> · {t('timeline.window', { n: data.loadedFilings })}</span>
          )}
        </div>
        <div className="seg">
          {METRICS.map((m) => (
            <button key={m} className={metric === m ? 'active' : ''} onClick={() => setMetric(m)}>
              {t(`timeline.metric.${m}`)}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 200, marginTop: 8 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={getVar('--grid')} vertical={false} />
            <XAxis
              dataKey="reportDate"
              tickFormatter={quarterLabel}
              tick={{ fill: mutC, fontSize: 11 }}
              axisLine={{ stroke: getVar('--border') }}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
            />
            <YAxis
              tickFormatter={fmtAxis(metric)}
              tick={{ fill: mutC, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={metric === 'weight' ? 44 : 60}
            />
            <Tooltip content={<TipBox metric={metric} t={t} />} cursor={{ fill: mutC, fillOpacity: 0.1 }} />
            <Bar dataKey="y" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {chartData.map((q) => (
                <Cell
                  key={q.reportDate}
                  fill={q.action === 'ADD' || q.action === 'NEW' ? getVar('--pos') : q.action === 'REDUCE' ? getVar('--neg') : posC}
                  fillOpacity={q.held ? 0.9 : 0}
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="timeline-badges">
        {quarters.map((q) => (
          <div key={q.reportDate} className={`timeline-q${q.filed ? '' : ' unfiled'}`} title={q.filed ? '' : t('timeline.notFiled')}>
            <div className="muted small">{quarterLabel(q.reportDate)}</div>
            {q.filed && q.action !== 'NONE' ? (
              <span className={`badge ${ACTION_CLASS[q.action]}`}>{t(`timeline.action.${q.action}`)}</span>
            ) : (
              <span className="muted small">{q.filed ? '—' : '·'}</span>
            )}
          </div>
        ))}
      </div>
      {data.plan === 'free' && (
        <p className="muted small mt8">
          {t('timeline.freeNote')} <Link to="/pricing">{t('paywall.cta')}</Link>
        </p>
      )}
      {isPro && data.truncated && limit == null && (
        <p className="muted small mt8">{t('timeline.truncatedNote')}</p>
      )}
    </div>
  );
}
