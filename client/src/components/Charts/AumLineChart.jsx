import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { fmtMoney, quarterLabel } from '../../lib/format.js';
import { getVar, tooltipStyle } from './chartUtils.js';

export default function AumLineChart({ history }) {
  const data = history.map((h) => ({ q: quarterLabel(h.reportDate), aum: h.aum }));
  const c = getVar('--chart-1');
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
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
          domain={['auto', 'auto']}
        />
        <Tooltip
          contentStyle={tooltipStyle()}
          formatter={(v) => [fmtMoney(v), 'AUM']}
          cursor={{ stroke: getVar('--text-2'), strokeDasharray: '3 3' }}
        />
        <Area
          type="monotone"
          dataKey="aum"
          stroke={c}
          strokeWidth={2}
          fill={c}
          fillOpacity={0.12}
          dot={{ r: 3, fill: c, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
