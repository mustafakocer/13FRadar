import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useGuruStock } from '../hooks/useGuruStock.js';
import { managerPath } from '../lib/paths.js';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format.js';

// The funds behind one row, opened in place.
//
// A consensus table's whole claim is "this many funds agree", and the names
// were the one thing a reader could not reach: three of them, truncated, with
// no way to see the rest or what any of them actually did. This is that list —
// every holder the tier allows, each linked to its own page, with the weight
// it carries and how the position moved last quarter.
//
// It is fetched when the row opens rather than shipped with the table: the
// full roll for five hundred securities is megabytes nobody scrolls.
export default function HoldersPanel({ ticker, cusip, colSpan }) {
  const { t } = useI18n();
  const { isLoading, ready, held, holders, holdersTruncated, stock } = useGuruStock({ ticker, cusip });

  const body = () => {
    if (isLoading) return <span className="muted small">{t('common.loading')}</span>;
    if (!ready) return <span className="muted small">{t('stockscreen.building')}</span>;
    if (!held || !holders.length) return <span className="muted small">{t('consensus.noHolders')}</span>;
    return (
      <>
        <table className="data">
          <thead>
            <tr>
              <th className="l">{t('screen.manager')}</th>
              <th>{t('table.weight')}</th>
              <th>{t('table.value')}</th>
              <th>{t('table.shares')}</th>
              <th className="l">{t('consensus.activity')}</th>
            </tr>
          </thead>
          <tbody>
            {holders.map((h) => (
              <tr key={h.cik}>
                <td className="l">
                  <Link to={managerPath(h.cik)}>{h.name}</Link>
                </td>
                <td className="num">{fmtPct(h.weight, { sign: false })}</td>
                <td className="num">{fmtMoney(h.value)}</td>
                <td className="num">{fmtNum(h.shares)}</td>
                <td className="l">
                  <span
                    className={
                      h.activity === 'reduce' ? 'delta-neg' : h.activity === 'hold' ? 'muted' : 'delta-pos'
                    }
                  >
                    {t(`guru.act.${h.activity}`)}
                    {h.change != null && ` ${fmtPct(h.change)}`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {holdersTruncated && (
          <div className="small muted mt8">
            <Link to="/pricing">
              {t('consensus.moreHolders').replace('{n}', fmtNum(stock.holderCount))} →
            </Link>
          </div>
        )}
      </>
    );
  };

  return (
    <tr className="row-expand">
      <td colSpan={colSpan} style={{ background: 'var(--popover)', padding: '10px 14px' }}>
        {body()}
      </td>
    </tr>
  );
}
