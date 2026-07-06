import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtMoney, fmtNum, fmtPct, deltaClass } from '../lib/format.js';
import { exportHoldingsToExcel } from '../lib/exportExcel.js';
import { useI18n } from '../i18n.jsx';

const COLS = [
  { key: 'rank', tKey: 'table.rank', left: true },
  { key: 'ticker', tKey: 'table.symbol', left: true },
  { key: 'issuer', tKey: 'table.company', left: true },
  { key: 'putCall', tKey: 'table.type' },
  { key: 'value', tKey: 'table.value' },
  { key: 'weight', tKey: 'table.weight' },
  { key: 'shares', tKey: 'table.shares' },
  { key: 'ret1y', tKey: 'table.ret1y' },
  { key: 'retYtd', tKey: 'table.retYtd' },
];

export default function HoldingsTable({ positions, returns, exportName }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState({ key: 'value', dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [exporting, setExporting] = useState(false);

  const maxWeight = positions[0]?.weight || 1;

  const rows = useMemo(() => {
    const ranked = positions.map((p, i) => ({
      ...p,
      rank: i + 1,
      ret1y: returns?.[p.ticker]?.ret1y ?? null,
      retYtd: returns?.[p.ticker]?.retYtd ?? null,
    }));
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? ranked.filter(
          (p) =>
            (p.ticker || '').toLowerCase().includes(f) ||
            (p.issuer || '').toLowerCase().includes(f)
        )
      : ranked;
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }, [positions, returns, filter, sort]);

  const visible = showAll ? rows : rows.slice(0, 100);

  const onSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key ? -s.dir : key === 'ticker' || key === 'issuer' ? 1 : -1 }));

  const onExport = async () => {
    setExporting(true);
    try {
      await exportHoldingsToExcel(positions, returns, exportName || 'holdings.xlsx');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card">
      <div className="table-tools">
        <input
          className="search-input sm"
          style={{ maxWidth: 280 }}
          placeholder={t('table.filter')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted small">
          {rows.length} {t('table.showing')}
        </span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={onExport} disabled={exporting}>
          {exporting ? '…' : `⬇ ${t('table.export')}`}
        </button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.key} className={c.left ? 'l' : ''} onClick={() => onSort(c.key)}>
                  {t(c.tKey)}
                  {sort.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={`${p.cusip}|${p.putCall}`}>
                <td className="l muted">{p.rank}</td>
                <td className="l">
                  {p.ticker ? (
                    <Link to={`/stock/${p.ticker}`} style={{ fontWeight: 700 }}>
                      {p.ticker}
                    </Link>
                  ) : (
                    <span className="muted small">{p.cusip}</span>
                  )}
                </td>
                <td className="l" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {p.issuer}
                </td>
                <td>
                  {p.putCall ? (
                    <span className="badge type">{p.putCall.toUpperCase()}</span>
                  ) : (
                    <span className="muted small">SH</span>
                  )}
                </td>
                <td className="num">{fmtMoney(p.value)}</td>
                <td className="num">
                  {fmtPct(p.weight, { sign: false, digits: 2 })}
                  <span className="wbar-track">
                    <i style={{ width: `${Math.min(100, (p.weight / maxWeight) * 100)}%` }} />
                  </span>
                </td>
                <td className="num">{fmtNum(p.shares)}</td>
                <td className={`num ${deltaClass(p.ret1y)}`}>{fmtPct(p.ret1y)}</td>
                <td className={`num ${deltaClass(p.retYtd)}`}>{fmtPct(p.retYtd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && rows.length > 100 && (
        <button className="btn ghost mt16" onClick={() => setShowAll(true)}>
          {t('common.all')} ({rows.length})
        </button>
      )}
    </div>
  );
}
