import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { POPULAR_MANAGERS, managerStyle } from '../data/popular.js';
import { CATS, catCounts, filterGurus, chipName, isClosed } from '../lib/guruBrowse.js';
import { managerPath } from '../lib/paths.js';
import { useI18n } from '../i18n.jsx';
import { fmtPct, deltaClass } from '../lib/format.js';
import FavoriteButton from './FavoriteButton.jsx';

// The curated funds with category tabs and a "show closed" switch — the
// same control on the home page (chips, the first `limit`, then "see all")
// and on /gurus (cards, all of them). Counts on the tabs are funds still
// filing, so they add up to the tracked count.
// perf: { [cik]: { y1, spy1 } } from /api/guru-performance — when given,
// the cards offer a "best performance" order and print the 1Y figure.
export default function GuruBrowser({ limit = null, variant = 'chips', onPrefetch = null, pathFor = null, perf = null }) {
  const { t } = useI18n();
  const [cat, setCat] = useState('all');
  const [showClosed, setShowClosed] = useState(false);
  const [byPerf, setByPerf] = useState(false);
  const counts = useMemo(() => catCounts(POPULAR_MANAGERS), []);
  const closedCount = POPULAR_MANAGERS.filter(isClosed).length;
  const rows = useMemo(() => {
    const list = filterGurus(POPULAR_MANAGERS, { cat, showClosed });
    if (!byPerf || !perf) return list;
    // funds with a figure first, best year on top; the rest keep their order
    const score = (g) => perf[g.cik]?.y1;
    return [...list].sort((a, b) => {
      const x = score(a);
      const y = score(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    });
  }, [cat, showClosed, byPerf, perf]);
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
        {perf && variant === 'cards' && (
          <button className={`chip sm${byPerf ? ' fsel-active' : ''}`} onClick={() => setByPerf((v) => !v)} aria-pressed={byPerf} data-perf-toggle style={{ marginLeft: 'auto' }}>
            {byPerf ? t('perf.sortName') : t('perf.sortBest')}
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
              <h3 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <span>{g.name}{isClosed(g) && <span className="muted small"> {t('guru.closed')}</span>}</span>
                <FavoriteButton cik={g.cik} name={g.name} small />
              </h3>
              {managerStyle(g.cik) && <p className="muted small">{t(`style.${managerStyle(g.cik)}`)}</p>}
              {perf?.[g.cik]?.y1 != null && (
                <p className="small" style={{ margin: '4px 0 0' }} data-perf-line>
                  <span className={deltaClass(perf[g.cik].y1)} style={{ fontWeight: 700 }}>{fmtPct(perf[g.cik].y1)}</span>
                  <span className="muted"> 1Y · {t('perf.vsSpy').replace('{spy}', fmtPct(perf[g.cik].spy1))}</span>
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
