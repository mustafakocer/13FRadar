import { ResponsiveContainer, BarChart, Bar, Tooltip } from 'recharts';
import { getVar, tooltipStyle } from './chartUtils.js';

// Tiny trend bars for stat cards. Hovering a bar reveals the period label and
// the underlying value so the history is readable, not just decorative.
export default function SparkBar({ values, labels, format, color = '--s1' }) {
  const data = values.map((v, i) => ({ i, v, label: labels?.[i] }));
  if (!data.length) return null;
  const fmt = (v) => (format ? format(v) : v == null ? '—' : String(v));
  const hasLabels = data.some((d) => d.label);
  return (
    <div style={{ height: 36, marginTop: 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <Tooltip
            content={<SparkTip fmt={fmt} hasLabels={hasLabels} />}
            cursor={{ fill: getVar('--muted'), fillOpacity: 0.15 }}
            allowEscapeViewBox={{ x: true, y: true }}
            wrapperStyle={{ zIndex: 10 }}
            position={{ y: -56 }}
            isAnimationActive={false}
          />
          <Bar dataKey="v" fill={getVar(color)} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SparkTip({ active, payload, fmt, hasLabels }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ ...tooltipStyle(), padding: '6px 10px', whiteSpace: 'nowrap', pointerEvents: 'none' }}>
      {hasLabels && d.label && (
        <div style={{ color: getVar('--muted'), fontSize: 12 }}>{d.label}</div>
      )}
      <div style={{ fontWeight: 600 }}>{fmt(d.v)}</div>
    </div>
  );
}
