import { Link } from 'react-router-dom';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { useI18n } from '../i18n.jsx';

// One-glance superinvestor signal for a stock: how many gurus bought/sold it
// this quarter and who holds it. Free feature — it is the discovery hook.
export default function GuruSignal({ ticker, cusip }) {
  const { t } = useI18n();
  const { data } = useConsensusStatic();
  if (!data) return null;

  const match = (r) =>
    (cusip && r.cusip === cusip) || (r.ticker && r.ticker === ticker);

  const held = data.mostHeld?.find(match);
  const bought = data.topBought?.find(match);
  const sold = data.topSold?.find(match);
  const fresh = (data.newPositions || []).filter(match);

  const buyers = bought?.buyers ?? held?.buyers ?? 0;
  const sellers = sold?.sellers ?? held?.sellers ?? 0;
  const holders = held?.holders || [];

  if (!held && !bought && !sold && !fresh.length) return null;

  const tone = buyers > sellers ? 'pos' : sellers > buyers ? 'neg' : 'plain';
  const icon = buyers > sellers ? '🟢' : sellers > buyers ? '🔴' : '⚪';

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <b>{icon} {t('guru.title')}</b>
          <div className="small muted" style={{ marginTop: 2 }}>
            {buyers > 0 || sellers > 0 ? (
              <>
                {t('guru.thisQuarter')}{' '}
                {buyers > 0 && <b className="delta-pos">{buyers} {t('guru.bought')}</b>}
                {buyers > 0 && sellers > 0 && ' · '}
                {sellers > 0 && <b className="delta-neg">{sellers} {t('guru.sold')}</b>}
                {held && <> · {held.holderCount} {t('guru.holding')}</>}
              </>
            ) : (
              held && <>{held.holderCount} {t('guru.holding')}</>
            )}
            {fresh.length > 0 && (
              <>
                {' '}· ✨ {fresh.map((f, i) => (
                  <span key={f.cik}>
                    {i > 0 && ', '}
                    <Link to={`/manager/${f.cik}`}>{f.manager}</Link>
                  </span>
                ))}{' '}
                {t('guru.freshEntry')}
              </>
            )}
          </div>
          {holders.length > 0 && (
            <div className="small muted" style={{ marginTop: 4 }}>
              {t('guru.heldBy')}:{' '}
              {holders.slice(0, 4).map((h, i) => (
                <span key={h.cik}>
                  {i > 0 && ', '}
                  <Link to={`/manager/${h.cik}`}>{h.name}</Link>
                </span>
              ))}
              {held.holderCount > 4 && ` +${held.holderCount - 4}`}
            </div>
          )}
        </div>
        <span className={`badge ${tone}`} style={{ flexShrink: 0 }}>
          <Link to="/consensus" style={{ color: 'inherit', textDecoration: 'none' }}>
            {t('guru.seeAll')} →
          </Link>
        </span>
      </div>
    </div>
  );
}
