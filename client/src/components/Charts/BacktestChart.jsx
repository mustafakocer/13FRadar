import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { getVar, tooltipStyle } from './chartUtils.js';

// Copy-the-13F NAV vs SPY, both indexed to 1.0 at the first rebalance.
export default function BacktestChart({ points, labels }) {
  const c1 = getVar('--s1');
  const c2 = getVar('--s3');
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={getVar('--grid')} vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fill: getVar('--muted'), fontSize: 11 }}
          axisLine={{ stroke: getVar('--border') }}
          tickLine={false}
          minTickGap={40}
        />
        <YAxis
          domain={['auto', 'auto']}
          tickFormatter={(v) => `${v}x`}
          tick={{ fill: getVar('--muted'), fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(v) => `${Number(v).toFixed(3)}x`}
          cursor={{ stroke: getVar('--muted'), strokeDasharray: '3 3' }}
        />
        <Legend formatter={(v) => <span style={{ color: getVar('--ink'), fontSize: 13 }}>{v}</span>} />
        <Line type="monotone" dataKey="port" name={labels.port} stroke={c1} strokeWidth={2} dot={{ r: 3 }} />
        <Line type="monotone" dataKey="spy" name="SPY" stroke={c2} strokeWidth={2} dot={{ r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
