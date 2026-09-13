import { fmtMoney, quarterLabel } from '../lib/format.js';

// Four quarters of net guru activity in one cell.
//
// Direction is carried by which side of the baseline a bar sits on, so the
// buy/sell colours are a second signal rather than the only one. Bars are
// scaled within the row, which is what makes them comparable across quarters
// for that ticker — never across rows.
export default function GuruActivityBars({ series = [], quarters = [], label }) {
  if (!series.length) return <span className="muted">—</span>;
  const peak = Math.max(...series.map((v) => Math.abs(v)), 1);
  const W = 11;
  const GAP = 5;
  const H = 30;
  const mid = H / 2;
  const width = series.length * W + (series.length - 1) * GAP;

  return (
    <svg
      className="spark-bars"
      width={width}
      height={H}
      viewBox={`0 0 ${width} ${H}`}
      role="img"
      aria-label={label}
    >
      <line x1="0" y1={mid} x2={width} y2={mid} stroke="var(--border)" strokeWidth="1" />
      {series.map((v, i) => {
        // every non-zero quarter keeps a visible stub, so "small" never reads
        // as "nothing happened"
        const h = v === 0 ? 0 : Math.max(2, (Math.abs(v) / peak) * (mid - 2));
        const x = i * (W + GAP);
        const q = quarters[i];
        return (
          <g key={q || i}>
            <rect
              x={x}
              y={v >= 0 ? mid - h : mid}
              width={W}
              height={h}
              rx="1"
              fill={v >= 0 ? 'var(--buy)' : 'var(--sell)'}
            />
            <title>
              {q ? `${quarterLabel(q)}: ` : ''}
              {v >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(v))}
            </title>
          </g>
        );
      })}
    </svg>
  );
}
