import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { api } from '../../lib/api.js';
import { fmtNum, fmtPct } from '../../lib/format.js';
import { getVar, tooltipStyle } from './chartUtils.js';

const RANGES = ['1mo', '3mo', '6mo', '1y', '5y'];
const LABELS = { tr: { '1mo': '1A', '3mo': '3A', '6mo': '6A', '1y': '1Y', '5y': '5Y' },
                 en: { '1mo': '1M', '3mo': '3M', '6mo': '6M', '1y': '1Y', '5y': '5Y' } };

export default function PriceChart({ ticker, lang = 'tr' }) {
  const [range, setRange] = useState('1y');
  const { data, isLoading } = useQuery({
    queryKey: ['chart', ticker, range],
    queryFn: () => api.chart(ticker, range),
    staleTime: 30 * 60 * 1000,
  });

  const prices = data?.prices || [];
  const first = prices[0]?.close;
  const last = prices[prices.length - 1]?.close;
  const up = first != null && last != null ? last >= first : true;
  const c = getVar(up ? '--pos' : '--neg');
  const changePct = first ? ((last - first) / first) * 100 : null;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="row">
          {RANGES.map((r) => (
            <button
              key={r}
              className={`chip${r === range ? ' active-chip' : ''}`}
              style={r === range ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-ink)' } : {}}
              onClick={() => setRange(r)}
            >
              {LABELS[lang]?.[r] || r}
            </button>
          ))}
        </div>
        {changePct != null && (
          <span className={`badge ${changePct >= 0 ? 'pos' : 'neg'}`}>{fmtPct(changePct)}</span>
        )}
      </div>
      {isLoading ? (
        <div className="loading" style={{ height: 260, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={prices} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <defs>
              <linearGradient id={`pxFill-${up}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c} stopOpacity={0.22} />
                <stop offset="100%" stopColor={c} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={getVar('--grid')} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: getVar('--muted'), fontSize: 11 }}
              axisLine={{ stroke: getVar('--border') }}
              tickLine={false}
              minTickGap={48}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fill: getVar('--muted'), fontSize: 11 }}
              tickFormatter={(v) => fmtNum(v, 0)}
              axisLine={false}
              tickLine={false}
              width={54}
            />
            <Tooltip
              contentStyle={tooltipStyle()}
              formatter={(v) => [fmtNum(v, 2), ticker]}
              cursor={{ stroke: getVar('--muted'), strokeDasharray: '3 3' }}
            />
            <Area
              type="monotone"
              dataKey="close"
              stroke={c}
              strokeWidth={2}
              fill={`url(#pxFill-${up})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
