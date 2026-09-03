import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';
import { fmtMoney, fmtPct } from '../../lib/format.js';
import { getVar, tooltipStyle } from './chartUtils.js';

// Portfolio map: rectangle area = portfolio weight, colour = YTD return of the
// underlying stock (green up / red down / grey unknown).
const MAX_TILES = 40;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function tileFill(ret, pos, neg, mut) {
  if (ret == null || Number.isNaN(ret)) return `rgba(${hexToRgb(mut).join(',')},0.35)`;
  const k = Math.min(1, Math.abs(ret) / 30); // ±30% saturates
  const [r, g, b] = hexToRgb(ret >= 0 ? pos : neg);
  return `rgba(${r},${g},${b},${(0.35 + 0.6 * k).toFixed(2)})`;
}

function Tile(props) {
  const { x, y, width, height, depth, label, ret, pos, neg, mut, ink } = props;
  if (depth !== 1 || width <= 0 || height <= 0) return null;
  const showTicker = width > 38 && height > 20;
  const showSub = width > 56 && height > 40;
  const fs = Math.max(10, Math.min(18, width / 6, height / 2.6));
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill={tileFill(ret, pos, neg, mut)}
        stroke={getVar('--surface')}
        strokeWidth={2}
      />
      {showTicker && (
        <text
          x={x + width / 2}
          y={y + height / 2 + (showSub ? -2 : fs / 3)}
          textAnchor="middle"
          fill={ink}
          fontSize={fs}
          fontWeight={700}
          style={{ pointerEvents: 'none' }}
        >
          {label}
        </text>
      )}
      {showSub && (
        <text
          x={x + width / 2}
          y={y + height / 2 + fs * 0.95}
          textAnchor="middle"
          fill={ink}
          fontSize={Math.max(9, fs * 0.7)}
          opacity={0.85}
          style={{ pointerEvents: 'none' }}
        >
          {fmtPct(props.weight, { sign: false })}
          {ret != null ? ` · ${fmtPct(ret, { digits: 0 })}` : ''}
        </text>
      )}
    </g>
  );
}

function Tip({ active, payload, labels }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{ ...tooltipStyle(), padding: '8px 12px' }}>
      <div style={{ fontWeight: 700 }}>
        {d.label}
        {d.putCall ? ` (${d.putCall.toUpperCase()})` : ''}
      </div>
      <div className="muted small">{d.issuer}</div>
      <div style={{ marginTop: 4 }}>
        {labels.weight}: <b>{fmtPct(d.weight, { sign: false, digits: 2 })}</b> · {fmtMoney(d.usd)}
      </div>
      <div>
        {labels.ret}: <b>{d.ret != null ? fmtPct(d.ret) : '—'}</b>
      </div>
    </div>
  );
}

export default function HoldingsTreemap({ positions, returns, labels }) {
  const pos = getVar('--pos');
  const neg = getVar('--neg');
  const mut = getVar('--muted');
  const ink = getVar('--ink');
  const data = positions
    .filter((p) => p.weight > 0)
    .slice(0, MAX_TILES)
    .map((p) => ({
      label: p.ticker || (p.issuer || p.cusip).slice(0, 10),
      issuer: p.issuer,
      putCall: p.putCall || '',
      weight: p.weight,
      usd: p.value, // `value` is overwritten by recharts with the size
      size: p.weight,
      ret: p.ticker ? returns?.[p.ticker]?.retYtd ?? null : null,
    }));
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <Treemap
        data={data}
        dataKey="size"
        aspectRatio={4 / 3}
        isAnimationActive={false}
        content={<Tile pos={pos} neg={neg} mut={mut} ink={ink} />}
      >
        <Tooltip content={<Tip labels={labels} />} />
      </Treemap>
    </ResponsiveContainer>
  );
}
