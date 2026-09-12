import { Link } from 'react-router-dom';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { useI18n } from '../i18n.jsx';
import { managerPath } from '../lib/paths.js';
import Ico from './Ico.jsx';
import { TrendingUp, TrendingDown, Minus, Sparkles } from 'lucide-react';

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
  const Icon = buyers > sellers ? TrendingUp : sellers > buyers ? TrendingDown : Minus;
  const iconCls = tone === 'pos' ? 'text-buy' : tone === 'neg' ? 'text-sell' : 'text-text-2';

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: 'var(--border-strong)' }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <b><Ico icon={Icon} className={iconCls} /> {t('guru.title')}</b>
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
                {' '}· <Ico icon={Sparkles} size={14} /> {fresh.map((f, i) => (
                  <span key={f.cik}>
                    {i > 0 && ', '}
                    <Link to={managerPath(f.cik, f.path)}>{f.manager}</Link>
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
                  <Link to={managerPath(h.cik, h.path)}>{h.name}</Link>
                </span>
              ))}
              {held.holderCount > 4 && ` +${held.holderCount - 4}`}
            </div>
          )}
        </div>
        <span className="badge plain" style={{ flexShrink: 0 }}>
          <Link to="/consensus" style={{ color: 'inherit', textDecoration: 'none' }}>
            {t('guru.seeAll')} →
          </Link>
        </span>
      </div>
    </div>
  );
}
