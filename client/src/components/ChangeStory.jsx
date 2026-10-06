import { Link } from 'react-router-dom';
import { fmtPct } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import Ico from './Ico.jsx';
import { Plus, Minus, BookOpen } from 'lucide-react';
import { heldBeforeListing } from '../lib/newListings.js';
import { useListedOn } from '../hooks/useListedOn.js';
import CompanyName from './CompanyName.jsx';
import TickerLogo from './TickerLogo.jsx';

const Tick = ({ p }) =>
  p.ticker ? (
    <Link to={`/stock/${p.ticker}?cusip=${p.cusip}`} className="tk-cell" style={{ fontWeight: 700 }}>
      <TickerLogo ticker={p.ticker} size={16} /> {p.ticker}
    </Link>
  ) : (
    <b><CompanyName name={p.issuer} /></b>
  );

// Narrative recap of the selected quarter's portfolio changes — the same
// `changes` the FAQ reads (GET /api/changes, portfolioChanges.js): by share
// count against the complete previous book.
export default function ChangeStory({ changes }) {
  const { t } = useI18n();
  const listedOn = useListedOn();
  if (!changes?.counts) return null;
  const c = changes.counts;
  const fresh = changes.new;
  const exited = changes.exited;
  // the largest add and the largest cut, by the money that moved
  const inc = changes.added[0] || null;
  const dec = changes.reduced[0] || null;

  const lines = [];
  if (c.new)
    lines.push(
      <span key="new">
        <b className="delta-pos">{c.new}</b> {t('story.boughtNew')}{' '}
        {fresh.slice(0, 3).map((p, i) => (
          <span key={`${p.cusip}|${p.putCall || ''}`}>
            {i > 0 && ', '}
            <Tick p={p} /> <span className="muted">({fmtPct(p.weight, { sign: false })}{!p.putCall && heldBeforeListing(p, changes.reportDate, listedOn) ? ` · ${t('manager.preIpoBadge')}` : ''})</span>
          </span>
        ))}
        {c.new > 3 && <span className="muted"> +{c.new - 3}</span>}
      </span>
    );
  if (c.exited)
    lines.push(
      <span key="exit">
        <b className="delta-neg">{c.exited}</b> {t('story.exitedAll')}{' '}
        {exited.slice(0, 3).map((p, i) => (
          <span key={`${p.cusip}|${p.putCall || ''}`}>
            {i > 0 && ', '}
            <Tick p={p} />
          </span>
        ))}
        {c.exited > 3 && <span className="muted"> +{c.exited - 3}</span>}
      </span>
    );
  if (inc)
    lines.push(
      <span key="inc">
        <Ico icon={Plus} /> {t('story.mostInc')} <Tick p={inc} />{' '}
        <b className="delta-pos">{fmtPct(inc.pct, { digits: 1 })}</b> <span className="muted">{t('story.shares')}</span>
      </span>
    );
  if (dec)
    lines.push(
      <span key="dec">
        <Ico icon={Minus} /> {t('story.mostDec')} <Tick p={dec} />{' '}
        <b className="delta-neg">{fmtPct(dec.pct, { digits: 1 })}</b> <span className="muted">{t('story.shares')}</span>
      </span>
    );

  return (
    <div className="card" style={{ marginBottom: 16, background: 'var(--popover)', borderColor: 'var(--border-strong)' }}>
      <h3><Ico icon={BookOpen} /> {t('story.title')}</h3>
      {lines.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>{lines}</div>
      ) : (
        <span className="muted small">{t('story.noChanges')}</span>
      )}
    </div>
  );
}
