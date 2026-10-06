import { Link } from 'react-router-dom';
import { fmtPct, deltaClass } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import CompanyName from './CompanyName.jsx';
import { heldBeforeListing } from '../lib/newListings.js';
import { useListedOn } from '../hooks/useListedOn.js';
import { securityLabel } from '../lib/label.js';
import Ico from './Ico.jsx';
import TickerLogo from './TickerLogo.jsx';
import { Trophy, TrendingUp, TrendingDown } from 'lucide-react';

function Row({ p, badge, delta }) {
  const name = securityLabel(p).text;
  const body = (
    <>
      {p.ticker ? <TickerLogo ticker={p.ticker} size={28} /> : null}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="tick">
          {name}
          {p.putCall ? <span className="badge type" style={{ marginLeft: 6 }}>{p.putCall.toUpperCase()}</span> : null}
          {badge ? <span className="badge type" style={{ marginLeft: 6 }}>{badge}</span> : null}
        </div>
        <div className="issuer"><CompanyName name={p.coName || p.issuer} /></div>
      </div>
      <div className="right">
        <div className="w">{fmtPct(p.weight, { sign: false })}</div>
        {delta != null && (
          <div className={`d ${deltaClass(delta)}`}>{fmtPct(delta, { digits: 1 })}</div>
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

// Three-column portfolio digest: biggest positions, new/added, reduced/exited
// — the last two from the filing's `changes` (GET /api/changes, the same
// answer the FAQ gives): by share count, the change shown in shares.
export default function PositionCards({ positions, changes }) {
  const { t } = useI18n();
  const listedOn = useListedOn();
  const hasPrev = Boolean(changes?.counts);
  const top = positions.slice(0, 8);
  const increased = hasPrev ? [...changes.new.map((p) => ({ ...p, isNew: true, preIpo: !p.putCall && heldBeforeListing(p, changes.reportDate, listedOn) })), ...changes.added].slice(0, 8) : [];
  const decreased = hasPrev ? [...changes.reduced, ...changes.exited.map((p) => ({ ...p, isExit: true, weight: p.prevWeight }))].slice(0, 8) : [];

  return (
    <div className="grid grid-3">
      <div className="card pos-col">
        <h3><Ico icon={Trophy} /> {t('manager.topHoldings')}</h3>
        {top.map((p) => (
          <Row key={`${p.cusip}|${p.putCall}`} p={p} delta={null} />
        ))}
      </div>
      <div className="card pos-col">
        <h3><Ico icon={TrendingUp} className="text-buy" /> {t('manager.increased')}</h3>
        {!hasPrev && <div className="muted small">{t('manager.noPrev')}</div>}
        {increased.map((p) => (
          <Row
            key={`${p.cusip}|${p.putCall}`}
            p={p}
            badge={p.preIpo ? t('manager.preIpoBadge') : p.isNew ? t('manager.newBadge') : null}
            delta={p.isNew ? null : p.pct}
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
            delta={p.isExit ? null : p.pct}
          />
        ))}
      </div>
    </div>
  );
}
