import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { fmtMoney, quarterLabel } from '../../lib/format.js';
import { getVar, tooltipStyle } from './chartUtils.js';

export default function FlowBarChart({ history, label }) {
  const data = history
    .filter((h) => h.estFlow != null)
    .map((h) => ({ q: quarterLabel(h.reportDate), flow: h.estFlow }));
  if (!data.length) return null;
  const pos = getVar('--buy');
  const neg = getVar('--sell');
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={getVar('--border')} vertical={false} />
        <XAxis
          dataKey="q"
          tick={{ fill: getVar('--text-2'), fontSize: 12 }}
          axisLine={{ stroke: getVar('--border') }}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => fmtMoney(v)}
          tick={{ fill: getVar('--text-2'), fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={62}
        />
        <ReferenceLine y={0} stroke={getVar('--border')} />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(v) => [fmtMoney(v), label]}
          cursor={{ fill: getVar('--popover') }}
        />
        <Bar dataKey="flow" radius={[4, 4, 0, 0]} maxBarSize={34}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.flow >= 0 ? pos : neg} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
