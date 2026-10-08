import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtNum } from '../lib/format.js';
import { breadcrumbs } from '../lib/seoTemplates.js';
import { dataset, itemList } from '../lib/jsonld.js';
import AnswerBox from '../components/AnswerBox.jsx';
import Ico from '../components/Ico.jsx';
import TickerLogo from '../components/TickerLogo.jsx';
import CongressTable, { CommitteeBoard, CongressDisclaimer, MemberBoard, TickerBoard } from '../components/CongressTable.jsx';

const TABS = ['latest', 'bought', 'sold', 'active', 'largest', 'committees'];
const HOUR = 60 * 60 * 1000;

// /congress — trades by members of the US Congress, from their STOCK Act
// periodic transaction reports (House Clerk, Senate eFD).
export default function Congress() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState('latest');
  const [f, setF] = useState({ ch: '', p: '', kind: '', q: '' });
  const [page, setPage] = useState(0);
  const o = useQuery({ queryKey: ['congress'], queryFn: api.congress, staleTime: HOUR });
  const filtered = !!(f.ch || f.p || f.kind || f.q.trim() || page);
  const fq = useQuery({
    queryKey: ['congress-feed', f, page],
    queryFn: () => api.congressFeed({ ...f, q: f.q.trim(), offset: page * 100, limit: 100 }),
    enabled: filtered,
    staleTime: HOUR,
    placeholderData: keepPreviousData,
  });
  const d = o.data;
  const set = (k, v) => {
    setPage(0);
    setF((s) => ({ ...s, [k]: v }));
  };
  const answer = d
    ? (lang === 'tr'
        ? 'ABD Kongre üyelerinin {n} hisse işlemi kayıtlı ({m} üye, {since} sonrası bildirimler). Son 90 günde {recent} işlem: {buys} alım, {sells} satış. En çok üyenin aldığı hisse: {top}. Son bildirim: {last}.'
        : '{n} trades by members of the US Congress are on file ({m} members, disclosures since {since}). In the last 90 days: {recent} trades — {buys} buys, {sells} sells. Bought by the most members: {top}. Latest disclosure: {last}.')
        .replace('{n}', fmtNum(d.counts?.rows))
        .replace('{m}', fmtNum(d.counts?.members))
        .replace('{since}', d.since || '—')
        .replace('{recent}', fmtNum(d.recentCount))
        .replace('{buys}', fmtNum(d.buys))
        .replace('{sells}', fmtNum(d.sells))
        .replace('{top}', d.topBought?.[0] ? `${d.topBought[0].t} (${d.topBought[0].members})` : '—')
        .replace('{last}', d.lastFiled || '—')
    : null;
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Kongre Hisse İşlemleri: ABD Senatörleri ve Temsilcilerinin Alım-Satımları | Fundocap' : 'Congress Stock Trades: What US Senators and Representatives Buy and Sell | Fundocap',
        description: answer ? answer.slice(0, 155) : undefined,
        answer,
        path: '/congress',
        dateModified: d?.updatedAt?.slice(0, 10) || null,
        jsonLd: d
          ? [
              dataset({
                name: lang === 'tr' ? 'ABD Kongresi hisse işlemleri' : 'US Congress stock trades',
                description: answer,
                lang,
                path: '/congress',
                isBasedOn: 'https://disclosures-clerk.house.gov/FinancialDisclosure',
                dateModified: d.updatedAt,
                temporalCoverage: `${d.since}/${d.lastFiled}`,
                keywords: ['STOCK Act', 'congress trading', 'periodic transaction report'],
              }),
              itemList({ name: lang === 'tr' ? 'En aktif Kongre üyeleri' : 'Most active members of Congress', lang, items: (d.active || []).slice(0, 20).map((m) => ({ name: m.n, path: `/congress/${m.slug}` })) }),
              breadcrumbs(lang, [[lang === 'tr' ? 'Kongre İşlemleri' : 'Congress Trades', '/congress']]),
            ]
          : [],
      }),
      [lang, d, answer]
    )
  );
  if (o.isLoading) return <div className="loading"><div className="spinner" />{t('common.loading')}</div>;
  if (!d) return <div className="error-box">{t('cg.unavailable')}</div>;
  const latest = filtered ? fq.data?.rows : d.latest;
  const total = filtered ? fq.data?.total : null;
  const p = d.party || {};
  return (
    <div>
      <div className="page-head">
        <div>
          <h1><Ico icon={Gavel} size={22} /> {t('cg.title')}</h1>
          <div className="sub">{t('cg.subtitle')}</div>
        </div>
      </div>
      <AnswerBox text={answer} />

      <div className="fund-stats mt16">
        <div className="fund-stat">
          <span className="k">{t('cg.stat.trades')}</span>
          <b>{fmtNum(d.recentCount)}</b>
          <span className="s">{t('cg.stat.window').replace('{n}', d.window?.days || 90)}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.stat.split')}</span>
          <b><span className="text-buy">{fmtNum(d.buys)}</span> / <span className="text-sell">{fmtNum(d.sells)}</span></b>
          <span className="s">{t('cg.stat.splitNote')}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.stat.party')}</span>
          <b><span className="party-d">D {fmtNum(p.D)}</span> · <span className="party-r">R {fmtNum(p.R)}</span>{p.I ? <> · <span className="party-i">I {fmtNum(p.I)}</span></> : null}</b>
          <span className="s">{t('cg.stat.partyNote')}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.stat.top')}</span>
          {d.topBought?.[0] ? (
            <>
              <b><Link to={`/stock/${d.topBought[0].t}`} className="tk-cell"><TickerLogo ticker={d.topBought[0].t} size={24} /> {d.topBought[0].t}</Link></b>
              <span className="s">{t('cg.stat.topNote').replace('{n}', d.topBought[0].members)}</span>
            </>
          ) : (
            <b>—</b>
          )}
        </div>
      </div>

      <div className="home-tabs ins-tabs mt16" role="tablist">
        {TABS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`home-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {t(`cg.tab.${k}`)}
          </button>
        ))}
      </div>

      <div className="card mt16">
        {tab === 'latest' && (
          <>
            <div className="cg-filters">
              <input className="search-input sm" type="search" value={f.q} placeholder={t('cg.searchPh')} aria-label={t('cg.searchPh')} onChange={(e) => set('q', e.target.value)} />
              <select className="select" value={f.ch} onChange={(e) => set('ch', e.target.value)} aria-label={t('cg.chamber')}>
                <option value="">{t('cg.allChambers')}</option>
                <option value="H">{t('cg.house')}</option>
                <option value="S">{t('cg.senate')}</option>
              </select>
              <select className="select" value={f.p} onChange={(e) => set('p', e.target.value)} aria-label={t('cg.party')}>
                <option value="">{t('cg.allParties')}</option>
                <option value="D">{t('cg.party.D')}</option>
                <option value="R">{t('cg.party.R')}</option>
                <option value="I">{t('cg.party.I')}</option>
              </select>
              <select className="select" value={f.kind} onChange={(e) => set('kind', e.target.value)} aria-label={t('cg.type')}>
                <option value="">{t('cg.allKinds')}</option>
                <option value="buy">{t('cg.kind.buy')}</option>
                <option value="sell">{t('cg.kind.sell')}</option>
              </select>
              {total != null && <span className="muted small">{t('cg.found').replace('{n}', fmtNum(total))}</span>}
            </div>
            {filtered && fq.isLoading ? <div className="loading"><div className="spinner" /></div> : <CongressTable rows={latest} />}
            {filtered && total > 100 && (
              <div className="row mt16" style={{ gap: 8 }}>
                <button type="button" className="btn ghost sm" disabled={page === 0} onClick={() => setPage((x) => Math.max(0, x - 1))}>←</button>
                <span className="muted small">{page * 100 + 1}–{Math.min(total, page * 100 + 100)} / {fmtNum(total)}</span>
                <button type="button" className="btn ghost sm" disabled={(page + 1) * 100 >= total} onClick={() => setPage((x) => x + 1)}>→</button>
              </div>
            )}
            {!filtered && <p className="muted small mt8">{t('cg.latestNote')}</p>}
          </>
        )}
        {tab === 'bought' && <TickerBoard rows={d.topBought} />}
        {tab === 'sold' && <TickerBoard rows={d.topSold} />}
        {tab === 'active' && <MemberBoard rows={d.active} />}
        {tab === 'largest' && <CongressTable rows={d.largest} />}
        {tab === 'committees' && <CommitteeBoard rows={d.committees} />}
        {tab !== 'latest' && tab !== 'committees' && <p className="muted small mt8">{t('cg.windowNote').replace('{from}', d.window?.from || '')}</p>}
      </div>

      <div className="card mt16">
        <h3>{t('cg.howTitle')}</h3>
        <p className="muted small">{t('cg.how1')}</p>
        <p className="muted small">{t('cg.how2')}</p>
        <p className="muted small">{t('cg.how3')}</p>
        <CongressDisclaimer />
      </div>
    </div>
  );
}
