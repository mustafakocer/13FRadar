import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { fmtPct } from '../../lib/format.js';
import { getVar, seriesColors, tooltipStyle } from './chartUtils.js';
import { useI18n } from '../../i18n.jsx';
import { sectorSlices } from '../../lib/sectorSlices.js';

export default function SectorPie({ positions, sectors, loading = false }) {
  const { t } = useI18n();
  const colors = seriesColors();
  if (loading) return <div className="skel" style={{ height: 300, borderRadius: 10 }} />;
  const { data } = sectorSlices(positions, sectors, { unclassified: t('sector.unclassified'), other: t('common.other') });
  if (!data.length) return <div className="muted small">{t('sector.empty')}</div>;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        {/* The mount-time animation is off on purpose: this chart mounts
            after its data arrives and is re-parented once the page hydrates,
            and Recharts' animation state does not survive that — the legend
            rendered while every arc stayed at radius zero. */}
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke={getVar('--card')} strokeWidth={2} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={d.name} fill={d.unclassified ? getVar('--text-2') : colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle()} formatter={(v) => fmtPct(v, { sign: false })} />
        <Legend
          formatter={(value, entry) => (
            <span style={{ color: getVar('--text'), fontSize: 13 }}>
              {value}{' '}
              <span style={{ color: getVar('--text-2') }}>{fmtPct(entry.payload.value, { sign: false })}</span>
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
