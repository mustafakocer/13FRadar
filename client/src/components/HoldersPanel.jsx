import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useGuruStock } from '../hooks/useGuruStock.js';
import { managerPath } from '../lib/paths.js';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format.js';

// The funds behind one row, opened in place.
//
// A consensus table's whole claim is "this many funds agree", and the names
// were the one thing a reader could not reach: three of them, truncated, with
// no way to see the rest or what any of them actually did.
//
// Two sources, in order of preference:
//   · the per-security table, when the daily build has produced it — every
//     holder the tier allows, with shares and what the position did;
//   · the holders the static consensus file already carries on the row (up
//     to six, name and weight), which is what a fresh checkout has.
// The inline list renders at once, so opening a row never shows a spinner
// for data the page already had in hand.
export default function HoldersPanel({ ticker, cusip, holders: inline = [], holderCount = 0, colSpan }) {
  const { t } = useI18n();
  const full = useGuruStock({ ticker, cusip });
  const useFull = full.ready && full.held && full.holders.length > 0;
  const rows = useFull ? full.holders : inline;
  const total = useFull ? full.stock.holderCount : holderCount || inline.length;
  const truncated = useFull ? full.holdersTruncated : total > inline.length;

  return (
    <tr className="row-expand">
      <td colSpan={colSpan} style={{ background: 'var(--popover)', padding: '10px 14px' }}>
        {rows.length === 0 ? (
          <span className="muted small">{t('consensus.noHolders')}</span>
        ) : (
          <>
            <div className="table-wrap"><table className="data">
              <thead>
                <tr>
                  <th className="l">{t('screen.manager')}</th>
                  <th>{t('table.weight')}</th>
                  {useFull && <th>{t('table.value')}</th>}
                  {useFull && <th className="l">{t('consensus.activity')}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((h) => (
                  <tr key={h.cik}>
                    <td className="l">
                      <Link to={managerPath(h.cik, h.path)}>{h.name}</Link>
                    </td>
                    <td className="num">{h.weight != null ? fmtPct(h.weight, { sign: false }) : '—'}</td>
                    {useFull && <td className="num">{fmtMoney(h.value)}</td>}
                    {useFull && (
                      <td className="l">
                        <span className={h.activity === 'reduce' ? 'delta-neg' : h.activity === 'hold' ? 'muted' : 'delta-pos'}>
                          {t(`guru.act.${h.activity}`)}
                          {h.change != null && ` ${fmtPct(h.change)}`}
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table></div>
            {truncated && (
              <div className="small muted mt8">
                {useFull ? (
                  <Link to="/pricing">{t('consensus.moreHolders').replace('{n}', fmtNum(total))} →</Link>
                ) : (
                  // the static file carries six names; the rest arrive with the
                  // per-security table once the daily build has run
                  t('consensus.moreHoldersSoon').replace('{n}', fmtNum(total))
                )}
              </div>
            )}
          </>
        )}
      </td>
    </tr>
  );
}
