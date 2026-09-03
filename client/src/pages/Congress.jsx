import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import Paywall from '../components/Paywall.jsx';
import ExportButtons from '../components/ExportButtons.jsx';

const AMOUNTS = [['all', 0], ['15k', 15001], ['50k', 50001], ['250k', 250001], ['1m', 1000001]];
const FREE_ROWS = 20;
const PARTY_CLASS = { D: 'party-d', R: 'party-r', I: 'party-i' };

export default function Congress() {
  const { t } = useI18n();
  const { isPro } = useAuth();
  usePageTitle(`${t('congress.title')} — 13F Radar`);
  const [tab, setTab] = useState('all');
  const [chamber, setChamber] = useState('all');
  const [party, setParty] = useState('all');
  const [amount, setAmount] = useState('all');
  const [q, setQ] = useState('');
  const feed = useQuery({ queryKey: ['congress-feed'], queryFn: () => api.congressFeed(), staleTime: 30 * 60 * 1000, retry: 0 });

  const rows = useMemo(() => {
    const all = feed.data?.rows || [];
    const min = AMOUNTS.find((a) => a[0] === amount)?.[1] ?? 0;
    const needle = q.trim().toUpperCase();
    return all.filter(
      (r) =>
        (tab === 'all' || r.type === tab) &&
        (chamber === 'all' || r.chamber === chamber) &&
        (party === 'all' || String(r.party) === party) &&
        (r.amountMin || 0) >= min &&
        (!needle || (r.ticker || '').includes(needle) || r.member.toUpperCase().includes(needle) || (r.asset || '').toUpperCase().includes(needle))
    );
  }, [feed.data, tab, chamber, party, amount, q]);
  const visible = isPro ? rows.slice(0, 500) : rows.slice(0, FREE_ROWS);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏛️ {t('congress.title')}</h1>
          <div className="sub">{t('congress.subtitle')}</div>
        </div>
      </div>
      <div className="tabs">
        {['all', 'buy', 'sell'].map((k) => (
          <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>{t(`congress.tab.${k === 'buy' ? 'buys' : k === 'sell' ? 'sells' : 'all'}`)}</button>
        ))}
      </div>
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="search-input sm" style={{ maxWidth: 220 }} placeholder={t('congress.search')} value={q} onChange={(e) => setQ(e.target.value)} disabled={!isPro} />
          <select className="select" value={chamber} onChange={(e) => setChamber(e.target.value)} disabled={!isPro}>
            {['all', 'house', 'senate'].map((c) => <option key={c} value={c}>{t(`congress.chamber.${c}`)}</option>)}
          </select>
          <select className="select" value={party} onChange={(e) => setParty(e.target.value)} disabled={!isPro}>
            {['all', 'D', 'R', 'I'].map((p) => <option key={p} value={p}>{t(`congress.party.${p}`)}</option>)}
          </select>
          <select className="select" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={!isPro}>
            {AMOUNTS.map(([k]) => <option key={k} value={k}>{t(`congress.amount.${k}`)}</option>)}
          </select>
          <ExportButtons name="congress_trades" rows={() => rows.map((r) => ({ transactionDate: r.transactionDate, disclosureDate: r.disclosureDate, chamber: r.chamber, member: r.member, party: r.party, state: r.state, ticker: r.ticker, asset: r.asset, type: r.type, amountMin: r.amountMin, amountMax: r.amountMax, link: r.link }))} compact />
          <span className="muted small">{rows.length} {t('congress.count')}{feed.data?.updatedAt ? ` · ${t('insiders.updated')} ${feed.data.updatedAt.slice(0, 10)}` : ''}</span>
        </div>
        {!isPro && <p className="muted small mt8">{t('congress.freeNote', { n: FREE_ROWS })} <Link to="/pricing">{t('paywall.cta')}</Link></p>}
      </div>
      {feed.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      {feed.error && <div className="card muted mt16">{t('congress.noData')}</div>}
      {feed.data && !rows.length && <div className="card muted mt16">{t('common.na')}</div>}
      {visible.length > 0 && (
        <div className="card mt16">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('congress.txDate')}</th>
                  <th className="l">{t('congress.member')}</th>
                  <th className="l">{t('table.symbol')}</th>
                  <th className="l">{t('congress.asset')}</th>
                  <th>{t('congress.type')}</th>
                  <th>{t('congress.amount')}</th>
                  <th className="l">{t('congress.disclosed')}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr key={r.id}>
                    <td className="l muted">{r.transactionDate}</td>
                    <td className="l">
                      <span className={`badge plain ${PARTY_CLASS[r.party] || ''}`} title={t(`congress.party.${r.party}`)}>{r.party || '?'}</span>{' '}
                      {r.member}
                      <span className="muted small"> · {r.chamber === 'house' ? t('congress.chamber.house') : t('congress.chamber.senate')}{r.state ? ` · ${r.state}` : ''}</span>
                    </td>
                    <td className="l">{r.ticker ? <Link to={`/stock/${r.ticker}`} style={{ fontWeight: 700 }}>{r.ticker}</Link> : '—'}</td>
                    <td className="l" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.asset}>{r.asset}</td>
                    <td><span className={`badge ${r.type === 'buy' ? 'pos' : r.type === 'sell' ? 'neg' : 'plain'}`}>{t(`congress.type.${r.type}`)}</span></td>
                    <td className="num">{r.amountBand}</td>
                    <td className="l muted small">{r.disclosureDate || '—'}{r.link && <> · <a href={r.link} target="_blank" rel="noreferrer">{t('congress.pdf')}</a></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isPro && rows.length > FREE_ROWS && <div className="mt16"><Paywall compact /></div>}
          <p className="muted small mt8">{t('congress.note')}</p>
        </div>
      )}
    </div>
  );
}
