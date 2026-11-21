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

// The chained 13F portfolio return against the index, one group of bars
// per horizon. Both bars of a group cover the same window (the caller
// passes what api/_lib/performance.js measured), so they can be compared.
// periods: [{ period, [label]: pct, … }] · series: [label, …], portfolio first.
export default function BenchmarkBars({ periods, series }) {
  const slots = ['--chart-1', '--chart-2', '--chart-3', '--chart-4'];
  const data = periods;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={getVar('--border')} vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fill: getVar('--text-500'), fontSize: 12 }}
          axisLine={{ stroke: getVar('--border') }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => fmtPct(v, { sign: false, digits: 0 })}
          tick={{ fill: getVar('--text-500'), fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <ReferenceLine y={0} stroke={getVar('--border')} />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(v) => fmtPct(v)}
          cursor={{ fill: getVar('--surface-alt') }}
        />
        <Legend
          formatter={(value) => (
            <span style={{ color: getVar('--ink'), fontSize: 13 }}>{value}</span>
          )}
        />
        {series.map((s, i) => (
          <Bar
            key={s}
            dataKey={s}
            fill={getVar(slots[i] || '--chart-6')}
            radius={[4, 4, 0, 0]}
            maxBarSize={44}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
