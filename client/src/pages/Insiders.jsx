import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import Paywall from '../components/Paywall.jsx';

const ROLES = ['ALL', 'CEO', 'CFO', 'COO', 'PRESIDENT', 'OFFICER', 'DIRECTOR', 'TEN_PCT', 'OTHER'];
const BANDS = [
  ['0', 0],
  ['100k', 1e5],
  ['1m', 1e6],
  ['10m', 1e7],
];
const FREE_ROWS = 20;

export default function Insiders() {
  const { t } = useI18n();
  const { isPro } = useAuth();
  usePageTitle(`${t('insiders.title')} — 13F Radar`);
  const [tab, setTab] = useState('buys'); // buys | sells | all
  const [role, setRole] = useState('ALL');
  const [band, setBand] = useState('0');
  const [q, setQ] = useState('');
  const feed = useQuery({ queryKey: ['insiders-feed'], queryFn: () => api.insidersFeed(), staleTime: 30 * 60 * 1000, retry: 0 });

  const rows = useMemo(() => {
    const all = feed.data?.rows || [];
    const min = BANDS.find((b) => b[0] === band)?.[1] ?? 0;
    const needle = q.trim().toUpperCase();
    let list = all.filter(
      (r) =>
        (tab === 'all' || (tab === 'buys' ? r.side === 'buy' : r.side === 'sell')) &&
        (role === 'ALL' || r.role === role) &&
        (r.value || 0) >= min &&
        (!needle || (r.symbol || '').includes(needle) || (r.issuer || '').toUpperCase().includes(needle) || (r.owner || '').toUpperCase().includes(needle))
    );
    if (tab !== 'all') list = [...list].sort((a, b) => (b.value || 0) - (a.value || 0));
    return list;
  }, [feed.data, tab, role, band, q]);

  const visible = isPro ? rows.slice(0, 500) : rows.slice(0, FREE_ROWS);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>👤 {t('insiders.title')}</h1>
          <div className="sub">{t('insiders.subtitle')}</div>
        </div>
      </div>
      <div className="tabs">
        {['buys', 'sells', 'all'].map((k) => (
          <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{t(`insiders.tab.${k}`)}</button>
        ))}
      </div>
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="search-input sm" style={{ maxWidth: 220 }} placeholder={t('insiders.search')} value={q} onChange={(e) => setQ(e.target.value)} disabled={!isPro} />
          <select className="select" value={role} onChange={(e) => setRole(e.target.value)} disabled={!isPro}>
            {ROLES.map((r) => <option key={r} value={r}>{t(`insiders.role.${r}`)}</option>)}
          </select>
          <select className="select" value={band} onChange={(e) => setBand(e.target.value)} disabled={!isPro}>
            {BANDS.map(([k]) => <option key={k} value={k}>{t(`insiders.band.${k}`)}</option>)}
          </select>
          <span className="muted small">{rows.length} {t('insiders.count')}{feed.data?.updatedAt ? ` · ${t('insiders.updated')} ${feed.data.updatedAt.slice(0, 10)}` : ''}</span>
        </div>
        {!isPro && <p className="muted small mt8">{t('insiders.freeNote', { n: FREE_ROWS })} <Link to="/pricing">{t('paywall.cta')}</Link></p>}
      </div>
      {feed.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {feed.error && <div className="card muted mt16">{t('insiders.noData')}</div>}
      {feed.data && !rows.length && <div className="card muted mt16">{t('common.na')}</div>}
      {visible.length > 0 && (
        <div className="card mt16">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('stock.insDate')}</th>
                  <th className="l">{t('table.symbol')}</th>
                  <th className="l">{t('table.company')}</th>
                  <th className="l">{t('stock.insOwner')}</th>
                  <th className="l">{t('insiders.roleCol')}</th>
                  <th>{t('stock.insSide')}</th>
                  <th>{t('table.shares')}</th>
                  <th>{t('stock.insPrice')}</th>
                  <th>{t('table.value')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr key={`${r.acc}-${i}`}>
                    <td className="l muted">{r.date}</td>
                    <td className="l">{r.symbol ? <Link to={`/stock/${r.symbol}`} style={{ fontWeight: 700 }}>{r.symbol}</Link> : '—'}</td>
                    <td className="l" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.issuer}</td>
                    <td className="l" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.owner}</td>
                    <td className="l muted small" title={r.title || ''}>{t(`insiders.role.${r.role}`)}</td>
                    <td><span className={`badge ${r.side === 'buy' ? 'pos' : 'neg'}`}>{t(`stock.ins.${r.side}`)} ({r.code})</span></td>
                    <td className="num">{fmtNum(r.shares)}</td>
                    <td className="num">{fmtNum(r.price, 2)}</td>
                    <td className="num">{fmtMoney(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isPro && rows.length > FREE_ROWS && <div className="mt16"><Paywall compact /></div>}
          <p className="muted small mt8">{t('insiders.note')}</p>
        </div>
      )}
    </div>
  );
}
