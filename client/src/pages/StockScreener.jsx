import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { exportRowsToExcel } from '../lib/exportExcel.js';
import Paywall from '../components/Paywall.jsx';

const DEFAULT = { q: '', minFunds: 0, minAdding: 0, netSign: 'any', minNetFlow: 0, minConsensus: -100, sector: 'all', size: 'all', sort: 'value', dir: -1 };
const SECTORS = ['Technology', 'Healthcare', 'Financials', 'Consumer Discretionary', 'Consumer Staples', 'Industrials', 'Energy', 'Materials', 'Communication', 'Utilities', 'Real Estate', 'Transportation', 'Services', 'Mining', 'Agriculture', 'Construction', 'Other'];
const SIZES = ['mega', 'large', 'mid', 'small', 'micro'];
const COLS = [
  ['ticker', 'table.symbol', true],
  ['issuer', 'table.company', true],
  ['sector', 'screener.sector', true],
  ['funds', 'screener.funds'],
  ['dFunds', 'screener.dFunds'],
  ['adding', 'screener.adding'],
  ['reducing', 'screener.reducing'],
  ['consensus', 'screener.consensus'],
  ['netFlow', 'screener.netFlow'],
  ['value', 'screener.value'],
  ['float', 'screener.float'],
];
const FREE_ROWS = 50;
const signed = (v, f = fmtNum) => (v == null ? '—' : (v > 0 ? '+' : '') + f(v));

export default function StockScreener() {
  const { t } = useI18n();
  const { isPro, user } = useAuth();
  const qc = useQueryClient();
  usePageTitle(`${t('screener.title')} — 13F Radar`);
  const [f, setF] = useState(DEFAULT);
  const [saveName, setSaveName] = useState('');
  const universe = useQuery({ queryKey: ['stocks-universe'], queryFn: () => api.stocksUniverse(), staleTime: Infinity, retry: 0 });
  const screens = useQuery({ queryKey: ['screens'], queryFn: () => api.screens.list(), enabled: !!user && isPro, retry: false });
  const save = useMutation({ mutationFn: () => api.screens.save(saveName.trim(), f), onSuccess: () => { setSaveName(''); qc.invalidateQueries({ queryKey: ['screens'] }); } });
  const del = useMutation({ mutationFn: (id) => api.screens.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['screens'] }) });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const rows = useMemo(() => {
    const all = universe.data?.rows || [];
    const needle = f.q.trim().toUpperCase();
    const list = all.filter(
      (r) =>
        (r.funds || 0) >= f.minFunds &&
        (r.adding || 0) >= f.minAdding &&
        (f.netSign === 'any' || (f.netSign === 'in' ? (r.netFlow || 0) > 0 : (r.netFlow || 0) < 0)) &&
        Math.abs(r.netFlow || 0) >= f.minNetFlow &&
        (f.minConsensus <= -100 || (r.consensus != null && r.consensus >= f.minConsensus)) &&
        (f.sector === 'all' || r.sector === f.sector) &&
        (f.size === 'all' || r.size === f.size) &&
        (!needle || (r.ticker || '').includes(needle) || (r.issuer || '').toUpperCase().includes(needle))
    );
    return [...list].sort((a, b) => {
      const av = a[f.sort];
      const bv = b[f.sort];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return typeof av === 'string' ? av.localeCompare(bv) * f.dir : (av - bv) * f.dir;
    });
  }, [universe.data, f]);
  const visible = isPro ? rows.slice(0, 500) : rows.slice(0, FREE_ROWS);
  const onSort = (key) => setF((s) => ({ ...s, sort: key, dir: s.sort === key ? -s.dir : key === 'ticker' || key === 'issuer' || key === 'sector' ? 1 : -1 }));
  const hasDiff = (universe.data?.rows || []).some((r) => r.diffFunds > 0);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🧪 {t('screener.title')}</h1>
          <div className="sub">{t('screener.subtitle')}</div>
        </div>
      </div>
      <div className="card">
        <div className="adv-grid">
          <label className="small">{t('screener.search')}<input className="search-input sm" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="AAPL" /></label>
          <label className="small">{t('screener.minFunds')}<input className="search-input sm" type="number" min="0" value={f.minFunds} onChange={(e) => set('minFunds', Number(e.target.value) || 0)} /></label>
          <label className="small">{t('screener.minAdding')}<input className="search-input sm" type="number" min="0" value={f.minAdding} onChange={(e) => set('minAdding', Number(e.target.value) || 0)} /></label>
          <label className="small">{t('screener.netSign')}
            <select className="select" value={f.netSign} onChange={(e) => set('netSign', e.target.value)}>
              <option value="any">{t('screener.net.any')}</option>
              <option value="in">{t('screener.net.in')}</option>
              <option value="out">{t('screener.net.out')}</option>
            </select>
          </label>
          <label className="small">{t('screener.minNetFlow')}<input className="search-input sm" type="number" min="0" step="1000000" value={f.minNetFlow} onChange={(e) => set('minNetFlow', Number(e.target.value) || 0)} /></label>
          <label className="small">{t('screener.minConsensus')}<input className="search-input sm" type="number" min="-100" max="100" value={f.minConsensus} onChange={(e) => set('minConsensus', Number(e.target.value))} /></label>
          <label className="small">{t('screener.sector')}
            <select className="select" value={f.sector} onChange={(e) => set('sector', e.target.value)}>
              <option value="all">{t('screen.all')}</option>
              {SECTORS.map((s) => <option key={s} value={s}>{t(`sector.${s}`)}</option>)}
            </select>
          </label>
          <label className="small">{t('screener.size')}
            <select className="select" value={f.size} onChange={(e) => set('size', e.target.value)}>
              <option value="all">{t('screen.all')}</option>
              {SIZES.map((s) => <option key={s} value={s}>{t(`screener.size.${s}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="row mt8" style={{ flexWrap: 'wrap' }}>
          <button className="btn ghost" onClick={() => setF(DEFAULT)}>{t('screen.clear')}</button>
          <span className="muted small">{rows.length} {t('screener.count')}{universe.data?.period ? ` · ${t('screener.period')} ${quarterLabel(universe.data.period)}` : ''}</span>
          {isPro && (
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => exportRowsToExcel(rows.slice(0, 2000).map((r) => ({ ticker: r.ticker, issuer: r.issuer, sector: r.sector, funds: r.funds, dFunds: r.dFunds, adding: r.adding, reducing: r.reducing, consensus: r.consensus, netFlow: r.netFlow, value: r.value, float: r.float })), 'stock_screen.xlsx')}>⬇ {t('table.export')}</button>
          )}
        </div>
        {isPro && user && (
          <div className="row mt8" style={{ flexWrap: 'wrap' }}>
            <input className="search-input sm" style={{ maxWidth: 220 }} placeholder={t('screener.saveName')} value={saveName} onChange={(e) => setSaveName(e.target.value)} />
            <button className="btn ghost" onClick={() => save.mutate()} disabled={!saveName.trim() || save.isPending}>{t('screener.save')}</button>
            {(screens.data?.items || []).map((s) => (
              <span key={s.id} className="badge plain">
                <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 600 }} onClick={() => setF({ ...DEFAULT, ...s.params })}>{s.name}</button>
                <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', marginLeft: 4 }} onClick={() => del.mutate(s.id)} aria-label={t('watchlist.remove')}>✕</button>
              </span>
            ))}
          </div>
        )}
        {!isPro && <p className="muted small mt8">{t('screener.freeNote', { n: FREE_ROWS })} <Link to="/pricing">{t('paywall.cta')}</Link></p>}
        {!hasDiff && universe.data && <p className="muted small mt8">{t('screener.noDiffNote')}</p>}
      </div>
      {universe.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {universe.error && <div className="card muted mt16">{t('screener.noData')}</div>}
      {visible.length > 0 && (
        <div className="card mt16">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">#</th>
                  {COLS.map(([k, tk, left]) => <th key={k} className={left ? 'l' : ''} onClick={() => onSort(k)}>{t(tk)}{f.sort === k ? (f.dir === -1 ? ' ↓' : ' ↑') : ''}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr key={r.cusip}>
                    <td className="l muted">{i + 1}</td>
                    <td className="l">{r.ticker ? <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }}>{r.ticker}</Link> : <span className="muted small">{r.cusip}</span>}</td>
                    <td className="l" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.issuer}</td>
                    <td className="l muted small">{r.sector ? t(`sector.${r.sector}`) : '—'}</td>
                    <td className="num">{fmtNum(r.funds)}</td>
                    <td className={`num ${r.dFunds > 0 ? 'delta-pos' : r.dFunds < 0 ? 'delta-neg' : ''}`}>{signed(r.dFunds)}</td>
                    <td className="num delta-pos">{r.diffFunds ? fmtNum(r.adding) : '—'}</td>
                    <td className="num delta-neg">{r.diffFunds ? fmtNum(r.reducing) : '—'}</td>
                    <td className="num">{r.consensus != null ? <span className={`badge ${r.consensus > 20 ? 'pos' : r.consensus < -20 ? 'neg' : 'plain'}`}>{signed(r.consensus)}</span> : '—'}</td>
                    <td className={`num ${r.netFlow > 0 ? 'delta-pos' : r.netFlow < 0 ? 'delta-neg' : ''}`}>{r.diffFunds ? signed(r.netFlow, fmtMoney) : '—'}</td>
                    <td className="num">{fmtMoney(r.value)}</td>
                    <td className="num" title={r.floatAsOf || ''}>{r.float != null ? fmtMoney(r.float) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isPro && rows.length > FREE_ROWS && <div className="mt16"><Paywall compact /></div>}
          <p className="muted small mt8">{t('screener.note')}</p>
        </div>
      )}
    </div>
  );
}
