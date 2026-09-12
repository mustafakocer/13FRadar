import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { fmtPct } from '../../lib/format.js';
import { getVar, tooltipStyle } from './chartUtils.js';

// Current-portfolio weighted return vs index ETFs, for 1Y and YTD.
// series: [{key, label, ret1y, retYtd}] — first entry is the portfolio.
export default function BenchmarkBars({ series }) {
  const slots = ['--chart-1', '--chart-2', '--chart-3', '--chart-4'];
  const data = [
    { period: '1Y', ...Object.fromEntries(series.map((s) => [s.label, s.ret1y])) },
    { period: 'YTD', ...Object.fromEntries(series.map((s) => [s.label, s.retYtd])) },
  ];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={getVar('--border')} vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fill: getVar('--text-2'), fontSize: 12 }}
          axisLine={{ stroke: getVar('--border') }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => fmtPct(v, { sign: false, digits: 0 })}
          tick={{ fill: getVar('--text-2'), fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <ReferenceLine y={0} stroke={getVar('--border')} />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(v) => fmtPct(v)}
          cursor={{ fill: getVar('--popover') }}
        />
        <Legend
          formatter={(value) => (
            <span style={{ color: getVar('--text'), fontSize: 13 }}>{value}</span>
          )}
        />
        {series.map((s, i) => (
          <Bar
            key={s.label}
            dataKey={s.label}
            fill={getVar(slots[i] || '--chart-6')}
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
