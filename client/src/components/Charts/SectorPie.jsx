import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { fmtPct } from '../../lib/format.js';
import { getVar, seriesColors, tooltipStyle } from './chartUtils.js';
import { useI18n } from '../../i18n.jsx';

// Sector allocation donut over positions whose ticker resolved to a sector.
// Weights are renormalized to the covered subset.
export default function SectorPie({ positions, sectors }) {
  const { t } = useI18n();
  const colors = seriesColors();

  const bySector = new Map();
  let covered = 0;
  for (const p of positions) {
    const s = p.ticker ? sectors?.[p.ticker] : null;
    if (!s) continue;
    covered += p.weight;
    bySector.set(s, (bySector.get(s) || 0) + p.weight);
  }
  if (!covered) return <div className="muted small">{t('common.na')}</div>;

  let data = [...bySector.entries()]
    .map(([name, w]) => ({ name, value: (w / covered) * 100 }))
    .sort((a, b) => b.value - a.value);
  if (data.length > 8) {
    const rest = data.slice(7).reduce((s, d) => s + d.value, 0);
    data = [...data.slice(0, 7), { name: t('common.other'), value: rest }];
  }

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
          stroke={getVar('--surface')}
          strokeWidth={2}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={colors[i] || getVar('--faint')} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle()} formatter={(v) => fmtPct(v, { sign: false })} />
        <Legend
          formatter={(value, entry) => (
            <span style={{ color: getVar('--ink'), fontSize: 13 }}>
              {value}{' '}
              <span style={{ color: getVar('--muted') }}>
                {fmtPct(entry.payload.value, { sign: false })}
              </span>
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
