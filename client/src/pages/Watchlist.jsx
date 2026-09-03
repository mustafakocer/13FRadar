import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { getSeenFiling } from '../hooks/useSeenFilings.js';
import { fmtMoney, fmtNum, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { LIMITS } from '../lib/planLimits.js';
import { flagOn } from '../lib/flags.js';
import SearchBox from '../components/SearchBox.jsx';
import GroupPortfolio from '../components/GroupPortfolio.jsx';

function Funds({ t }) {
  const { favorites, toggleFavorite } = useFavorites();
  const { isPro } = useAuth();
  const infos = useQueries({
    queries: favorites.map((f) => ({ queryKey: ['manager', f.cik], queryFn: () => api.manager(f.cik), staleTime: 30 * 60 * 1000 })),
  });
  return (
    <>
      {!favorites.length && <div className="card muted">{t('watchlist.empty')}</div>}
      {favorites.map((f, i) => {
        const latest = infos[i]?.data?.filings?.[0];
        const seen = getSeenFiling(f.cik);
        const isNew = latest && seen && latest.filingDate > seen;
        return (
          <div className="card row" key={f.cik} style={{ justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap' }}>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Link to={`/manager/${f.cik}`} style={{ fontWeight: 700, fontSize: 16 }}>{f.name}</Link>
              {isNew && <span className="badge pos">🔔 {t('watchlist.newFiling')}</span>}
              {latest && <span className="muted small">{quarterLabel(latest.reportDate)} · {latest.filingDate}</span>}
            </div>
            <div className="row">
              <span className="muted small">CIK {f.cik}</span>
              <button className="btn ghost" onClick={() => toggleFavorite(f)}>{t('watchlist.remove')}</button>
            </div>
          </div>
        );
      })}
      {!isPro && (
        <p className="muted small mt8">{t('watchlist.usage', { n: favorites.length, limit: LIMITS.free.watchlist })} <Link to="/pricing">{t('paywall.cta')}</Link></p>
      )}
    </>
  );
}

function Stocks({ t }) {
  const { user, isPro } = useAuth();
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState(null);
  const list = useQuery({ queryKey: ['watchlist-stocks'], queryFn: () => api.watchlistStocks.list(), enabled: !!user, retry: false });
  const universe = useQuery({ queryKey: ['stocks-universe'], queryFn: () => api.stocksUniverse(), staleTime: Infinity, retry: 0 });
  const add = useMutation({
    mutationFn: ({ cusip, ticker, name }) => api.watchlistStocks.add(cusip, ticker, name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['watchlist-stocks'] }); setInput(''); setMsg(null); },
    onError: (e) => setMsg(e.status === 402 ? t('watchlist.limit', { n: e.limit ?? LIMITS.free.watchlist }) : String(e.message)),
  });
  const remove = useMutation({ mutationFn: (cusip) => api.watchlistStocks.remove(cusip), onSuccess: () => qc.invalidateQueries({ queryKey: ['watchlist-stocks'] }) });
  if (!user) return <div className="card muted">{t('watchlist.signIn')} <Link to="/account">{t('account.signIn')}</Link></div>;

  const rows = universe.data?.rows || [];
  const byCusip = new Map(rows.map((r) => [r.cusip, r]));
  const onAdd = () => {
    const sym = input.trim().toUpperCase();
    const hit = rows.find((r) => r.ticker === sym);
    if (!hit) return setMsg(t('watchlist.notFound'));
    add.mutate({ cusip: hit.cusip, ticker: hit.ticker, name: hit.issuer });
  };
  const items = list.data?.items || [];
  return (
    <>
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="search-input sm" style={{ maxWidth: 220 }} placeholder={t('compare.tickerPlaceholder')} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onAdd()} />
          <button className="btn" onClick={onAdd} disabled={add.isPending || !input.trim()}>+</button>
          {msg && <span className="muted small">{msg} {msg.includes(String(LIMITS.free.watchlist)) && <Link to="/pricing">{t('paywall.cta')}</Link>}</span>}
        </div>
        <p className="muted small mt8">{t('watchlist.stockHint')}</p>
      </div>
      {list.isLoading && <div className="muted small mt8">{t('common.loading')}</div>}
      {!list.isLoading && !items.length && <div className="card muted mt16">{t('watchlist.stocksEmpty')}</div>}
      {items.length > 0 && (
        <div className="card mt16">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('table.symbol')}</th>
                  <th className="l">{t('table.company')}</th>
                  <th>{t('consensus.funds')}</th>
                  <th>Δ {t('consensus.funds')}</th>
                  <th>{t('consensus.totalValue')}</th>
                  <th>Δ {t('table.value')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const u = byCusip.get(s.cusip);
                  return (
                    <tr key={s.cusip}>
                      <td className="l"><Link to={`/stock/${s.ticker || u?.ticker || ''}?cusip=${s.cusip}`} style={{ fontWeight: 700 }}>{s.ticker || u?.ticker || s.cusip}</Link></td>
                      <td className="l" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || u?.issuer}</td>
                      <td className="num">{u ? fmtNum(u.funds) : '—'}</td>
                      <td className={`num ${u?.dFunds > 0 ? 'delta-pos' : u?.dFunds < 0 ? 'delta-neg' : ''}`}>{u?.dFunds != null ? (u.dFunds > 0 ? '+' : '') + fmtNum(u.dFunds) : '—'}</td>
                      <td className="num">{u ? fmtMoney(u.value) : '—'}</td>
                      <td className={`num ${u?.dValue > 0 ? 'delta-pos' : u?.dValue < 0 ? 'delta-neg' : ''}`}>{u?.dValue != null ? (u.dValue > 0 ? '+' : '') + fmtMoney(u.dValue) : '—'}</td>
                      <td><button className="btn ghost" onClick={() => remove.mutate(s.cusip)}>{t('watchlist.remove')}</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small mt8">
            {t('watchlist.stockNote', { period: universe.data?.period ? quarterLabel(universe.data.period) : '—', prev: universe.data?.prevPeriod ? quarterLabel(universe.data.prevPeriod) : '—' })}
          </p>
          {!isPro && <p className="muted small">{t('watchlist.usage', { n: items.length, limit: list.data?.limit ?? LIMITS.free.watchlist })} <Link to="/pricing">{t('paywall.cta')}</Link></p>}
        </div>
      )}
    </>
  );
}

function Groups({ t }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [weighting, setWeighting] = useState('aum');
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups.list(), enabled: !!user, retry: false });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['groups'] });
  const onErr = (e) => setMsg(e.status === 402 ? t('groups.limit', { n: e.limit ?? '' }) : String(e.message));
  const create = useMutation({ mutationFn: () => api.groups.create(name.trim(), weighting), onSuccess: () => { setName(''); setMsg(null); invalidate(); }, onError: onErr });
  const addMember = useMutation({ mutationFn: ({ id, mgr }) => api.groups.addMember(id, mgr.cik, mgr.name), onSuccess: () => { setMsg(null); invalidate(); }, onError: onErr });
  const removeMember = useMutation({ mutationFn: ({ id, cik }) => api.groups.removeMember(id, cik), onSuccess: invalidate });
  const removeGroup = useMutation({ mutationFn: (id) => api.groups.remove(id), onSuccess: invalidate });
  const rename = useMutation({ mutationFn: ({ id, patch }) => api.groups.rename(id, patch), onSuccess: invalidate });
  if (!user) return <div className="card muted">{t('watchlist.signIn')} <Link to="/account">{t('account.signIn')}</Link></div>;
  const list = groups.data?.groups || [];
  return (
    <>
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="search-input sm" style={{ maxWidth: 240 }} placeholder={t('groups.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create.mutate()} />
          <select className="select" value={weighting} onChange={(e) => setWeighting(e.target.value)}>
            <option value="aum">{t('groups.weighting.aum')}</option>
            <option value="equal">{t('groups.weighting.equal')}</option>
          </select>
          <button className="btn" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>{t('groups.create')}</button>
          {msg && <span className="muted small">{msg} <Link to="/pricing">{t('paywall.cta')}</Link></span>}
        </div>
        <p className="muted small mt8">{t('groups.desc')}</p>
      </div>
      {groups.isLoading && <div className="muted small mt8">{t('common.loading')}</div>}
      {groups.error && <div className="muted small mt8">{String(groups.error.message)}</div>}
      {!groups.isLoading && !list.length && <div className="card muted mt16">{t('groups.empty')}</div>}
      {list.map((g) => (
        <div className="card mt16" key={g.id}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>🗂 {g.name} <span className="muted small">· {t(`groups.weighting.${g.weighting}`)}</span></h3>
            <div className="row">
              <button className="btn ghost" onClick={() => rename.mutate({ id: g.id, patch: { weighting: g.weighting === 'aum' ? 'equal' : 'aum' } })}>{t('groups.toggleWeighting')}</button>
              <button className="btn ghost" onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? t('groups.hide') : t('groups.show')}</button>
              <button className="btn ghost" onClick={() => window.confirm(t('groups.confirmDelete')) && removeGroup.mutate(g.id)}>{t('watchlist.remove')}</button>
            </div>
          </div>
          <div className="head-badges mt8">
            {g.members.map((m) => (
              <span key={m.cik} className="badge plain">
                <Link to={`/manager/${m.cik}`}>{m.name || m.cik}</Link>
                <button style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit', marginLeft: 4 }} onClick={() => removeMember.mutate({ id: g.id, cik: m.cik })} aria-label={t('watchlist.remove')}>✕</button>
              </span>
            ))}
            {g.members.length < (groups.data?.limits?.members ?? 20) ? (
              <span style={{ minWidth: 220 }}><SearchBox small placeholder={t('groups.addFund')} onSelect={(mgr) => addMember.mutate({ id: g.id, mgr })} /></span>
            ) : (
              <span className="muted small">{t('groups.memberLimit', { n: groups.data?.limits?.members })}</span>
            )}
          </div>
          {open === g.id && (
            <div className="mt16">
              <GroupPortfolio ciks={g.members.map((m) => m.cik)} weighting={g.weighting} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

export default function Watchlist() {
  const { t } = useI18n();
  const [tab, setTab] = useState('funds');
  const tabs = ['funds', ...(flagOn('watchlists') ? ['stocks', 'groups'] : [])];
  return (
    <div>
      <div className="page-head">
        <h1>⭐ {t('watchlist.title')}</h1>
      </div>
      {tabs.length > 1 && (
        <div className="tabs">
          {tabs.map((k) => (
            <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{t(`watchlist.tab.${k}`)}</button>
          ))}
        </div>
      )}
      {tab === 'funds' && <Funds t={t} />}
      {tab === 'stocks' && <Stocks t={t} />}
      {tab === 'groups' && <Groups t={t} />}
    </div>
  );
}
