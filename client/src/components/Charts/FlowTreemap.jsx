import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';
import { fmtMoney, fmtNum } from '../../lib/format.js';
import { getVar, tooltipStyle } from './chartUtils.js';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// alpha grows with |flow| relative to the value held; ±15% saturates
const alphaFor = (intensity) => 0.25 + 0.6 * Math.min(1, Math.abs(intensity) / 0.15);
function fill(intensity, flow, pos, neg) {
  const [r, g, b] = hexToRgb(flow >= 0 ? pos : neg);
  return `rgba(${r},${g},${b},${alphaFor(intensity).toFixed(2)})`;
}

function Tile(props) {
  const { x, y, width, height, depth, name, flow, intensity, pos, neg, ink, surface, labels, isSector } = props;
  if (depth !== 1 || width <= 0 || height <= 0 || intensity == null) return null;
  const a = alphaFor(intensity);
  const textFill = a > 0.55 ? '#ffffff' : ink;
  const label = isSector ? labels.sector(name) : name;
  const fs = Math.max(9, Math.min(16, width / (label.length * 0.7), height / 2.6));
  const showText = width > 30 && height > 16;
  const showSub = isSector ? width > 90 && height > 40 : width > 60 && height > 36;
  return (
    <g>
      <rect x={x + 1} y={y + 1} width={Math.max(0, width - 2)} height={Math.max(0, height - 2)} fill={fill(intensity, flow, pos, neg)} stroke={surface} strokeWidth={2} rx={3} style={isSector ? { cursor: 'pointer' } : undefined} />
      {showText && (
        <text x={x + width / 2} y={y + height / 2 + (showSub ? -2 : fs / 3)} textAnchor="middle" fill={textFill} fontSize={fs} fontWeight={700} style={{ pointerEvents: 'none' }}>
          {label}
        </text>
      )}
      {showSub && (
        <text x={x + width / 2} y={y + height / 2 + fs} textAnchor="middle" fill={textFill} fontSize={Math.max(9, fs * 0.72)} opacity={0.9} style={{ pointerEvents: 'none' }}>
          {(flow > 0 ? '+' : '') + fmtMoney(flow)}
        </text>
      )}
    </g>
  );
}

function Tip({ active, payload, labels }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const isSector = !!d.isSector;
  return (
    <div style={{ ...tooltipStyle(), padding: '8px 12px' }}>
      <div style={{ fontWeight: 700 }}>{isSector ? labels.sector(d.name) : `${d.name}${d.issuer && d.issuer !== d.name ? ` · ${d.issuer}` : ''}`}</div>
      <div>{labels.flow}: <b>{(d.flow > 0 ? '+' : '') + fmtMoney(d.flow)}</b></div>
      {isSector ? (
        <div className="muted small">{labels.in} {fmtMoney(d.inflow)} · {labels.out} {fmtMoney(d.outflow)} · {d.count} {labels.stocks} · {labels.click}</div>
      ) : (
        <div className="muted small">{labels.value}: {fmtMoney(d.value)} · {labels.funds}: {fmtNum(d.funds)} · +{d.adding} / −{d.reducing}</div>
      )}
    </div>
  );
}

// nodes: one level of api/_lib/flowTree.buildFlowTree output (sectors, or one
// sector's stocks). The page owns the drill-down state; onSelect fires when a
// sector tile is clicked.
export default function FlowTreemap({ nodes, labels, onSelect, height = 460 }) {
  const pos = getVar('--pos');
  const neg = getVar('--neg');
  const ink = getVar('--ink');
  const surface = getVar('--surface');
  const data = nodes.map((n) => ({ ...n, children: undefined, isSector: Array.isArray(n.children) && n.children.length > 0, count: n.count }));
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Treemap
        data={data}
        dataKey="size"
        aspectRatio={4 / 3}
        isAnimationActive={false}
        onClick={(node) => node?.isSector && onSelect && onSelect(node.name)}
        content={<Tile pos={pos} neg={neg} ink={ink} surface={surface} labels={labels} />}
      >
        <Tooltip content={<Tip labels={labels} />} />
      </Treemap>
    </ResponsiveContainer>
  );
}
