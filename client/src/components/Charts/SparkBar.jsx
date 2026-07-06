import { ResponsiveContainer, BarChart, Bar } from 'recharts';
import { getVar } from './chartUtils.js';

// Tiny trend bars for stat cards (decorative trend; values live in the card).
export default function SparkBar({ values, color = '--s1' }) {
  const data = values.map((v, i) => ({ i, v }));
  if (!data.length) return null;
  return (
    <div style={{ height: 36, marginTop: 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <Bar dataKey="v" fill={getVar(color)} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
