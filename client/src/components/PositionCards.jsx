import { Link } from 'react-router-dom';
import { fmtPct, deltaClass } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { securityLabel } from '../lib/label.js';
import Ico from './Ico.jsx';
import { Trophy, TrendingUp, TrendingDown } from 'lucide-react';

function Row({ p, badge, delta }) {
  const name = securityLabel(p).text;
  const body = (
    <>
      <div style={{ minWidth: 0 }}>
        <div className="tick">
          {name}
          {p.putCall ? <span className="badge type" style={{ marginLeft: 6 }}>{p.putCall.toUpperCase()}</span> : null}
          {badge ? <span className="badge type" style={{ marginLeft: 6 }}>{badge}</span> : null}
        </div>
        <div className="issuer">{p.issuer}</div>
      </div>
      <div className="right">
        <div className="w">{fmtPct(p.weight, { sign: false })}</div>
        {delta != null && (
          <div className={`d ${deltaClass(delta)}`}>{fmtPct(delta, { digits: 2 })} pp</div>
        )}
      </div>
    </>
  );
  return p.ticker ? (
    <Link to={`/stock/${p.ticker}?cusip=${p.cusip}`} className="pos-row" style={{ color: 'inherit', textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    <div className="pos-row">{body}</div>
  );
}

// Three-column portfolio digest: biggest positions, new/increased, reduced/exited.
// Weight-change (percentage points) vs the previous quarter.
export default function PositionCards({ positions, prevPositions }) {
  const { t } = useI18n();
  const prevMap = new Map(
    (prevPositions || []).map((p) => [`${p.cusip}|${p.putCall}`, p])
  );
  const curMap = new Map(positions.map((p) => [`${p.cusip}|${p.putCall}`, p]));
  const hasPrev = prevPositions && prevPositions.length > 0;

  const withDelta = positions.map((p) => {
    const prev = prevMap.get(`${p.cusip}|${p.putCall}`);
    return { ...p, delta: prev ? p.weight - prev.weight : null, isNew: !prev };
  });

  const top = withDelta.slice(0, 8);
  const increased = hasPrev
    ? withDelta
        .filter((p) => p.isNew || (p.delta != null && p.delta > 0.05))
        .sort((a, b) => (b.isNew ? b.weight : b.delta) - (a.isNew ? a.weight : a.delta))
        .slice(0, 8)
    : [];
  const exited = hasPrev
    ? [...prevMap.values()]
        .filter((p) => !curMap.has(`${p.cusip}|${p.putCall}`))
        .map((p) => ({ ...p, delta: -p.weight, isExit: true }))
    : [];
  const decreased = hasPrev
    ? [...withDelta.filter((p) => p.delta != null && p.delta < -0.05), ...exited]
        .sort((a, b) => a.delta - b.delta)
        .slice(0, 8)
    : [];

  return (
    <div className="grid grid-3">
      <div className="card pos-col">
        <h3><Ico icon={Trophy} /> {t('manager.topHoldings')}</h3>
        {top.map((p) => (
          <Row key={`${p.cusip}|${p.putCall}`} p={p} delta={hasPrev ? p.delta : null} />
        ))}
      </div>
      <div className="card pos-col">
        <h3><Ico icon={TrendingUp} className="text-buy" /> {t('manager.increased')}</h3>
        {!hasPrev && <div className="muted small">{t('manager.noPrev')}</div>}
        {increased.map((p) => (
          <Row
            key={`${p.cusip}|${p.putCall}`}
            p={p}
            badge={p.isNew ? t('manager.newBadge') : null}
            delta={p.isNew ? null : p.delta}
          />
        ))}
      </div>
      <div className="card pos-col">
        <h3><Ico icon={TrendingDown} className="text-sell" /> {t('manager.decreased')}</h3>
        {!hasPrev && <div className="muted small">{t('manager.noPrev')}</div>}
        {decreased.map((p) => (
          <Row
            key={`${p.cusip}|${p.putCall}`}
            p={p}
            badge={p.isExit ? t('manager.exitBadge') : null}
            delta={p.isExit ? null : p.delta}
          />
        ))}
      </div>
    </div>
  );
}
