import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, deltaClass, quarterLabel } from '../lib/format.js';
import { exportHoldingsToExcel } from '../lib/exportExcel.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { Suspense } from 'react';
import { SparkBar } from './Charts/index.js';
import Paywall from './Paywall.jsx';

const COLS = [
  { key: 'rank', tKey: 'table.rank', left: true },
  { key: 'ticker', tKey: 'table.symbol', left: true },
  { key: 'issuer', tKey: 'table.company', left: true },
  { key: 'putCall', tKey: 'table.type' },
  { key: 'value', tKey: 'table.value' },
  { key: 'weight', tKey: 'table.weight' },
  { key: 'delta', tKey: 'table.delta' },
  { key: 'shares', tKey: 'table.shares' },
  { key: 'ret1y', tKey: 'table.ret1y' },
  { key: 'retYtd', tKey: 'table.retYtd' },
];

// Expanded row: weight history across recent quarters for one CUSIP.
function HistoryPanel({ cik, cusip, t }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['poshist', cik, cusip],
    queryFn: () => api.positionHistory(cik, cusip),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  if (error?.status === 402) return <Paywall compact />;
  if (isLoading) return <div className="muted small">{t('common.loading')}</div>;
  const hist = data?.history || [];
  const held = hist.filter((h) => h.weight > 0);
  if (!held.length) return <div className="muted small">{t('common.na')}</div>;
  return (
    <div className="row" style={{ gap: 24, alignItems: 'center' }}>
      <div>
        <b>{held.length}</b> {t('poshist.quarters')}
        <div className="muted small">
          {held.map((h) => `${quarterLabel(h.reportDate)}: ${fmtPct(h.weight, { sign: false })}`).join(' · ')}
        </div>
      </div>
      <div style={{ width: 220 }}>
        <Suspense fallback={<div style={{ height: 44 }} />}>
          <SparkBar values={hist.map((h) => h.weight)} />
        </Suspense>
      </div>
    </div>
  );
}

export default function HoldingsTable({ positions, prevPositions, returns, cik, exportName, total, locked }) {
  const { t } = useI18n();
  const { isPro } = useAuth();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState({ key: 'value', dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const maxWeight = positions[0]?.weight || 1;
  const hasPrev = !!prevPositions?.length;

  const rows = useMemo(() => {
    const prevMap = new Map(
      (prevPositions || []).map((p) => [`${p.cusip}|${p.putCall}`, p])
    );
    const ranked = positions.map((p, i) => {
      const prev = prevMap.get(`${p.cusip}|${p.putCall}`);
      return {
        ...p,
        rank: i + 1,
        delta: hasPrev ? p.weight - (prev?.weight || 0) : null,
        isNew: hasPrev && !prev,
        ret1y: returns?.[p.ticker]?.ret1y ?? null,
        retYtd: returns?.[p.ticker]?.retYtd ?? null,
      };
    });
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
  }, [positions, prevPositions, hasPrev, returns, filter, sort]);

  // free tier sees the top 10 positions only
  const visible = !isPro ? rows.slice(0, 10) : showAll ? rows : rows.slice(0, 100);

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

  const cols = hasPrev ? COLS : COLS.filter((c) => c.key !== 'delta');

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
          {locked && total > rows.length
            ? `${rows.length} / ${total} ${t('table.showing')}`
            : `${rows.length} ${t('table.showing')}`}
        </span>
        {isPro && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={onExport} disabled={exporting}>
            {exporting ? '…' : `⬇ ${t('table.export')}`}
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} className={c.left ? 'l' : ''} onClick={() => onSort(c.key)}>
                  {t(c.tKey)}
                  {sort.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => {
              const rowKey = `${p.cusip}|${p.putCall}`;
              return [
                <tr
                  key={rowKey}
                  onClick={() => cik && setExpanded(expanded === rowKey ? null : rowKey)}
                  style={cik ? { cursor: 'pointer' } : undefined}
                  title={cik ? t('table.history') : undefined}
                >
                  <td className="l muted">
                    {cik ? (expanded === rowKey ? '▾ ' : '▸ ') : ''}
                    {p.rank}
                  </td>
                  <td className="l" onClick={(e) => e.stopPropagation()}>
                    {p.ticker ? (
                      <Link
                        to={`/stock/${p.ticker}?cusip=${p.cusip}`}
                        style={{ fontWeight: 700 }}
                      >
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
                  {hasPrev && (
                    <td className={`num ${deltaClass(p.delta)}`}>
                      {p.isNew ? (
                        <span className="badge type">{t('manager.newBadge')}</span>
                      ) : (
                        fmtPct(p.delta, { digits: 2 })
                      )}
                    </td>
                  )}
                  <td className="num">{fmtNum(p.shares)}</td>
                  <td className={`num ${deltaClass(p.ret1y)}`}>{fmtPct(p.ret1y)}</td>
                  <td className={`num ${deltaClass(p.retYtd)}`}>{fmtPct(p.retYtd)}</td>
                </tr>,
                cik && expanded === rowKey ? (
                  <tr key={`${rowKey}-hist`}>
                    <td colSpan={cols.length} className="l" style={{ background: 'var(--surface-2)' }}>
                      <HistoryPanel cik={cik} cusip={p.cusip} t={t} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      {!isPro && (locked || rows.length > 10) && (
        <div className="mt16">
          {locked && total > rows.length && (
            <p className="muted small" style={{ marginBottom: 8 }}>
              {t('table.lockedNote').replace('{n}', String(total - rows.length))}
            </p>
          )}
          <Paywall compact>{null}</Paywall>
        </div>
      )}
      {isPro && !showAll && rows.length > 100 && (
        <button className="btn ghost mt16" onClick={() => setShowAll(true)}>
          {t('common.all')} ({rows.length})
        </button>
      )}
    </div>
  );
}
