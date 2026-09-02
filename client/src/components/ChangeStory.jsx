import { Link } from 'react-router-dom';
import { fmtPct } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';

const Tick = ({ p }) =>
  p.ticker ? (
    <Link to={`/stock/${p.ticker}?cusip=${p.cusip}`} style={{ fontWeight: 700 }}>
      {p.ticker}
    </Link>
  ) : (
    <b>{p.issuer}</b>
  );

// Narrative recap of the selected quarter's portfolio changes.
export default function ChangeStory({ positions, prevPositions }) {
  const { t } = useI18n();
  if (!prevPositions?.length) return null;

  const prevMap = new Map(prevPositions.map((p) => [`${p.cusip}|${p.putCall}`, p]));
  const curKeys = new Set(positions.map((p) => `${p.cusip}|${p.putCall}`));

  const withDelta = positions.map((p) => {
    const prev = prevMap.get(`${p.cusip}|${p.putCall}`);
    return { ...p, delta: prev ? p.weight - prev.weight : null, isNew: !prev };
  });
  const fresh = withDelta.filter((p) => p.isNew && p.weight > 0.1).sort((a, b) => b.weight - a.weight);
  const exited = prevPositions
    .filter((p) => !curKeys.has(`${p.cusip}|${p.putCall}`) && p.weight > 0.1)
    .sort((a, b) => b.weight - a.weight);
  const changed = withDelta.filter((p) => !p.isNew && p.delta != null);
  const inc = [...changed].sort((a, b) => b.delta - a.delta)[0];
  const dec = [...changed].sort((a, b) => a.delta - b.delta)[0];

  const lines = [];
  if (fresh.length)
    lines.push(
      <span key="new">
        🟢 <b>{fresh.length}</b> {t('story.boughtNew')}{' '}
        {fresh.slice(0, 3).map((p, i) => (
          <span key={p.cusip}>
            {i > 0 && ', '}
            <Tick p={p} /> <span className="muted">({fmtPct(p.weight, { sign: false })})</span>
          </span>
        ))}
        {fresh.length > 3 && <span className="muted"> +{fresh.length - 3}</span>}
      </span>
    );
  if (exited.length)
    lines.push(
      <span key="exit">
        🔴 <b>{exited.length}</b> {t('story.exitedAll')}{' '}
        {exited.slice(0, 3).map((p, i) => (
          <span key={p.cusip}>
            {i > 0 && ', '}
            <Tick p={p} />
          </span>
        ))}
        {exited.length > 3 && <span className="muted"> +{exited.length - 3}</span>}
      </span>
    );
  if (inc && inc.delta > 0.2)
    lines.push(
      <span key="inc">
        ➕ {t('story.mostInc')} <Tick p={inc} />{' '}
        <b className="delta-pos">{fmtPct(inc.delta, { digits: 1 })} pp</b>
      </span>
    );
  if (dec && dec.delta < -0.2)
    lines.push(
      <span key="dec">
        ➖ {t('story.mostDec')} <Tick p={dec} />{' '}
        <b className="delta-neg">{fmtPct(dec.delta, { digits: 1 })} pp</b>
      </span>
    );

  return (
    <div className="card" style={{ marginBottom: 16, background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}>
      <h3>📖 {t('story.title')}</h3>
      {lines.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>{lines}</div>
      ) : (
        <span className="muted small">{t('story.noChanges')}</span>
      )}
    </div>
  );
}
