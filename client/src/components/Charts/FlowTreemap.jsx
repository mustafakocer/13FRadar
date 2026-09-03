import { ResponsiveContainer, Treemap, Tooltip } from 'recharts';
import { fmtMoney, fmtNum } from '../../lib/format.js';
import { getVar, tooltipStyle } from './chartUtils.js';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function fill(intensity, flow, pos, neg) {
  const k = Math.min(1, Math.abs(intensity) / 0.15); // ±15% of held value saturates
  const [r, g, b] = hexToRgb(flow >= 0 ? pos : neg);
  return `rgba(${r},${g},${b},${(0.3 + 0.65 * k).toFixed(2)})`;
}

function Tile(props) {
  const { x, y, width, height, depth, name, flow, intensity, pos, neg, ink, surface, labels, drill } = props;
  if (width <= 0 || height <= 0) return null;
  if (depth === 1) {
    // sector frame
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={drill ? 'transparent' : fill(intensity, flow, pos, neg)} stroke={surface} strokeWidth={3} rx={4} />
        {width > 70 && height > 22 && (
          <text x={x + 6} y={y + 15} fill={ink} fontSize={12} fontWeight={700} style={{ pointerEvents: 'none' }}>
            {labels.sector(name)} {drill ? '' : `· ${fmtMoney(flow)}`}
          </text>
        )}
      </g>
    );
  }
  if (!drill) return null;
  const showText = width > 34 && height > 18;
  const fs = Math.max(9, Math.min(15, width / 6, height / 2.6));
  return (
    <g>
      <rect x={x + 1} y={y + 1} width={Math.max(0, width - 2)} height={Math.max(0, height - 2)} fill={fill(intensity, flow, pos, neg)} stroke={surface} strokeWidth={1} rx={2} />
      {showText && (
        <text x={x + width / 2} y={y + height / 2 + fs / 3} textAnchor="middle" fill={ink} fontSize={fs} fontWeight={700} style={{ pointerEvents: 'none' }}>
          {name}
        </text>
      )}
    </g>
  );
}

function Tip({ active, payload, labels }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const isSector = d.children != null;
  return (
    <div style={{ ...tooltipStyle(), padding: '8px 12px' }}>
      <div style={{ fontWeight: 700 }}>{isSector ? labels.sector(d.name) : `${d.name}${d.issuer && d.issuer !== d.name ? ` · ${d.issuer}` : ''}`}</div>
      <div>{labels.flow}: <b>{(d.flow > 0 ? '+' : '') + fmtMoney(d.flow)}</b></div>
      {isSector ? (
        <div className="muted small">{labels.in} {fmtMoney(d.inflow)} · {labels.out} {fmtMoney(d.outflow)} · {d.count} {labels.stocks}</div>
      ) : (
        <div className="muted small">{labels.value}: {fmtMoney(d.value)} · {labels.funds}: {fmtNum(d.funds)} · +{d.adding} / −{d.reducing}</div>
      )}
    </div>
  );
}

// tree: output of api/_lib/flowTree.buildFlowTree. drill=false shows sectors only.
export default function FlowTreemap({ tree, labels, drill = true, height = 460 }) {
  const pos = getVar('--pos');
  const neg = getVar('--neg');
  const ink = getVar('--ink');
  const surface = getVar('--surface');
  const data = drill ? tree.children : tree.children.map((c) => ({ ...c, children: undefined }));
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Treemap data={data} dataKey="size" aspectRatio={4 / 3} isAnimationActive={false} content={<Tile pos={pos} neg={neg} ink={ink} surface={surface} labels={labels} drill={drill} />}>
        <Tooltip content={<Tip labels={labels} />} />
      </Treemap>
    </ResponsiveContainer>
  );
}
