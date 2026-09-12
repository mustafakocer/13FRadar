import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { fmtPct } from '../../lib/format.js';
import { getVar, seriesColors, tooltipStyle } from './chartUtils.js';
import { useI18n } from '../../i18n.jsx';

// Composition donut: top 8 positions + Other. Identity is carried by the
// legend + tooltip (not color alone) per accessibility rules.
export default function PortfolioPie({ positions }) {
  const { t } = useI18n();
  const colors = seriesColors();
  const top = positions.slice(0, 8);
  const otherW = positions.slice(8).reduce((s, p) => s + p.weight, 0);
  const data = [
    ...top.map((p) => ({ name: p.ticker || p.issuer, value: p.weight })),
    ...(otherW > 0.01 ? [{ name: t('common.other'), value: otherW }] : []),
  ];
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
          stroke={getVar('--card')}
          strokeWidth={2}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={i < 8 ? colors[i % colors.length] : getVar('--chart-6')} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle()} formatter={(v) => fmtPct(v, { sign: false })} />
        <Legend
          formatter={(value, entry) => (
            <span style={{ color: getVar('--text'), fontSize: 13 }}>
              {value} <span style={{ color: getVar('--text-2') }}>{fmtPct(entry.payload.value, { sign: false })}</span>
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
