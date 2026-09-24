import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { POPULAR_MANAGERS, managerStyle } from '../data/popular.js';
import { CATS, catCounts, filterGurus, chipName, isClosed } from '../lib/guruBrowse.js';
import { managerPath } from '../lib/paths.js';
import { useI18n } from '../i18n.jsx';

// The curated funds with category tabs and a "show closed" switch — the
// same control on the home page (chips, the first `limit`, then "see all")
// and on /gurus (cards, all of them). Counts on the tabs are funds still
// filing, so they add up to the tracked count.
export default function GuruBrowser({ limit = null, variant = 'chips', onPrefetch = null, pathFor = null }) {
  const { t } = useI18n();
  const [cat, setCat] = useState('all');
  const [showClosed, setShowClosed] = useState(false);
  const counts = useMemo(() => catCounts(POPULAR_MANAGERS), []);
  const closedCount = POPULAR_MANAGERS.filter(isClosed).length;
  const rows = useMemo(() => filterGurus(POPULAR_MANAGERS, { cat, showClosed }), [cat, showClosed]);
  const shown = limit ? rows.slice(0, limit) : rows;
  const href = (g) => (pathFor && pathFor(g)) || managerPath(g.cik);

  return (
    <div data-guru-browser={variant}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: variant === 'chips' ? 'center' : 'flex-start' }} role="tablist">
        {CATS.map((c) => (
          <button key={c} role="tab" aria-selected={cat === c} className={`chip sm${cat === c ? ' fsel-active' : ''}`} onClick={() => setCat(c)} data-cat={c}>
            {t(`gurus.cat.${c}`)} <span className="muted">{counts[c]}</span>
          </button>
        ))}
        {closedCount > 0 && (
          <button className={`chip sm${showClosed ? ' fsel-active' : ''}`} onClick={() => setShowClosed((v) => !v)} aria-pressed={showClosed} data-closed-toggle>
            {t('gurus.showClosed').replace('{n}', closedCount)}
          </button>
        )}
      </div>

      {variant === 'chips' ? (
        <div className="chip-grid" data-guru-chips>
          {shown.map((m) => (
            <Link
              key={m.cik}
              to={href(m)}
              className={`chip${isClosed(m) ? ' muted' : ''}`}
              title={m.name}
              onMouseEnter={onPrefetch ? () => onPrefetch(m.cik) : undefined}
            >
              {chipName(m.name)}
              {isClosed(m) && <> {t('guru.closed')}</>}
            </Link>
          ))}
          {limit && rows.length > limit && (
            <Link to="/gurus" className="chip" style={{ fontWeight: 700 }} data-see-all>
              {t('gurus.seeAll').replace('{n}', counts.all)} →
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-3 mt16" data-guru-cards>
          {shown.map((g) => (
            <Link key={g.cik} to={href(g)} className={`card feature-card${isClosed(g) ? ' muted' : ''}`} title={g.name}>
              <h3>{g.name}{isClosed(g) && <span className="muted small"> {t('guru.closed')}</span>}</h3>
              <p className="muted small">
                {managerStyle(g.cik) ? t(`style.${managerStyle(g.cik)}`) + ' · ' : ''}CIK {g.cik}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
