import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, deltaClass, quarterLabel } from '../lib/format.js';
import { exportHoldingsToExcel } from '../lib/exportExcel.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import SparkBar from './Charts/SparkBar.jsx';
import Paywall from './Paywall.jsx';
import PositionTimeline from './PositionTimeline.jsx';
import InfoTip from './InfoTip.jsx';

const COLS = [
  { key: 'rank', tKey: 'table.rank', left: true },
  { key: 'ticker', tKey: 'table.symbol', left: true },
  { key: 'issuer', tKey: 'table.company', left: true },
  { key: 'putCall', tKey: 'table.type' },
  { key: 'value', tKey: 'table.value' },
  { key: 'weight', tKey: 'table.weight' },
  { key: 'delta', tKey: 'table.delta', needsPrev: true },
  { key: 'activity', tKey: 'table.activity', tip: 'tips.activityCol', needsPrev: true },
  { key: 'shares', tKey: 'table.shares' },
  { key: 'histBars', tKey: 'table.ownHist', tip: 'tips.ownHist', noSort: true },
  { key: 'avgGain', tKey: 'table.avgBuy', tip: 'tips.avgBuy' },
  { key: 'ret1y', tKey: 'table.ret1y' },
  { key: 'retYtd', tKey: 'table.retYtd' },
];

// Share-count change vs the prior quarter, ignoring stock splits.
export function shareChange(cur, prev) {
  if (!prev) return { dShares: null, pct: null, isNew: true };
  let prevShares = prev.shares || 0;
  if (cur.shares && prevShares && cur.value && prev.value) {
    const sr = cur.shares / prevShares;
    const pr = prev.value / prevShares / (cur.value / cur.shares);
    if (pr > 0 && Math.abs(sr / pr - 1) < 0.15 && (sr >= 1.9 || sr <= 0.55)) prevShares *= sr;
  }
  const d = (cur.shares || 0) - prevShares;
  return { dShares: d, pct: prevShares ? (d / prevShares) * 100 : null, isNew: false };
}

const fmtShares = (v) => {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '+';
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}k`;
  return `${s}${a}`;
};

export default function HoldingsTable({ positions, prevPositions, returns, cik, exportName }) {
  const { t } = useI18n();
  const { isPro } = useAuth();
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState('stocks'); // stocks | options | all
  const [sort, setSort] = useState({ key: 'value', dir: -1 });
  const [showAll, setShowAll] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const hasOptions = positions.some((p) => p.putCall);
  const maxWeight = positions[0]?.weight || 1;
  const hasPrev = !!prevPositions?.length;

  // Ownership history + estimated average buy price (Pro, one call per manager)
  const hist = useQuery({
    queryKey: ['holdhist', cik],
    queryFn: () => api.holdingsHistory(cik),
    enabled: !!cik && isPro,
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  const histMap = useMemo(() => {
    const m = new Map();
    for (const it of hist.data?.items || []) m.set(it.cusip, it);
    return m;
  }, [hist.data]);
  const histLabels = useMemo(
    () => (hist.data?.quarters || []).map(quarterLabel),
    [hist.data]
  );

  const rows = useMemo(() => {
    const prevMap = new Map(
      (prevPositions || []).map((p) => [`${p.cusip}|${p.putCall}`, p])
    );
    const ranked = positions.map((p, i) => {
      const prev = prevMap.get(`${p.cusip}|${p.putCall}`);
      const ch = hasPrev ? shareChange(p, prev) : { dShares: null, pct: null, isNew: false };
      const h = p.putCall ? null : histMap.get(p.cusip);
      const lastPx = p.shares ? p.value / p.shares : null;
      const avgBuy = h?.avgBuy ?? null;
      return {
        ...p,
        rank: i + 1,
        delta: hasPrev ? p.weight - (prev?.weight || 0) : null,
        isNew: hasPrev && !prev,
        dShares: ch.dShares,
        activity: ch.pct,
        hist: h,
        avgBuy,
        avgGain: avgBuy && lastPx ? (lastPx / avgBuy - 1) * 100 : null,
        ret1y: returns?.[p.ticker]?.ret1y ?? null,
        retYtd: returns?.[p.ticker]?.retYtd ?? null,
      };
    });
    const byKind =
      kind === 'all' || !hasOptions
        ? ranked
        : ranked.filter((p) => (kind === 'options' ? !!p.putCall : !p.putCall));
    const f = filter.trim().toLowerCase();
    const filtered = f
      ? byKind.filter(
          (p) =>
            (p.ticker || '').toLowerCase().includes(f) ||
            (p.issuer || '').toLowerCase().includes(f)
        )
      : byKind;
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
  }, [positions, prevPositions, hasPrev, hasOptions, kind, returns, filter, sort, histMap]);

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

  const cols = COLS.filter((c) => !c.needsPrev || hasPrev);
  const proCell = (content) =>
    isPro ? content : <span className="muted small">🔒 {t('table.proOnly')}</span>;

  return (
    <div className="card">
      <div className="table-tools">
        {hasOptions && (
          <div className="seg">
            {['stocks', 'options', 'all'].map((k) => (
              <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
                {t(`table.kind.${k}`)}
              </button>
            ))}
          </div>
        )}
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
                <th
                  key={c.key}
                  className={c.left ? 'l' : ''}
                  onClick={c.noSort ? undefined : () => onSort(c.key)}
                  style={c.noSort ? { cursor: 'default' } : undefined}
                >
                  {t(c.tKey)}
                  {c.tip && <InfoTip tip={c.tip} />}
                  {!c.noSort && sort.key === c.key ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
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
                  {hasPrev && (
                    <td className={`num ${deltaClass(p.activity)}`}>
                      {p.isNew ? (
                        <span className="badge pos">{t('table.newPos')}</span>
                      ) : p.activity == null ? (
                        '—'
                      ) : Math.abs(p.activity) < 0.005 ? (
                        <span className="muted">{t('table.unchanged')}</span>
                      ) : (
                        <>
                          {p.activity > 0 ? '▲ ' : '▼ '}
                          {fmtPct(p.activity, { digits: 2 })}
                          <span className="muted small"> ({fmtShares(p.dShares)})</span>
                        </>
                      )}
                    </td>
                  )}
                  <td className="num">{fmtNum(p.shares)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {proCell(
                      p.hist ? (
                        <div style={{ width: 96, display: 'inline-block' }}>
                          <SparkBar
                            values={p.hist.weights.map((w) => w ?? 0)}
                            labels={histLabels}
                            format={(v) => fmtPct(v, { sign: false, digits: 2 })}
                            height={24}
                            marginTop={0}
                          />
                        </div>
                      ) : p.putCall ? (
                        <span className="muted small">—</span>
                      ) : hist.isLoading ? (
                        <span className="muted small">…</span>
                      ) : (
                        <span className="muted small">—</span>
                      )
                    )}
                  </td>
                  <td className="num">
                    {proCell(
                      p.avgBuy ? (
                        <>
                          ${p.avgBuy >= 100 ? p.avgBuy.toFixed(0) : p.avgBuy.toFixed(2)}
                          <span className={`small ${deltaClass(p.avgGain)}`}> ({fmtPct(p.avgGain)})</span>
                        </>
                      ) : (
                        <span className="muted small">{hist.isLoading && !p.putCall ? '…' : '—'}</span>
                      )
                    )}
                  </td>
                  <td className={`num ${deltaClass(p.ret1y)}`}>{fmtPct(p.ret1y)}</td>
                  <td className={`num ${deltaClass(p.retYtd)}`}>{fmtPct(p.retYtd)}</td>
                </tr>,
                cik && expanded === rowKey ? (
                  <tr key={`${rowKey}-hist`}>
                    <td colSpan={cols.length} className="l" style={{ background: 'var(--surface-2)' }}>
                      <PositionTimeline cik={cik} cusip={p.cusip} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>
      {isPro && hist.data && (
        <p className="muted small mt8">{t('table.avgBuyNote')}</p>
      )}
      {!isPro && rows.length > 10 && (
        <div className="mt16">
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
