import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { homeSeo } from '../lib/seoTemplates.js';
import { fmtPct, deltaClass } from '../lib/format.js';
import { managerPath } from '../lib/paths.js';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import { useUniverseSummary } from '../hooks/useUniverseSummary.js';
import { fundCountLabel } from '../lib/fundCount.js';
import SearchBox from '../components/SearchBox.jsx';
import TickerLogo from '../components/TickerLogo.jsx';
import CompanyName from '../components/CompanyName.jsx';
import FavoriteButton from '../components/FavoriteButton.jsx';
import Ico from '../components/Ico.jsx';
import UpdatedLine from '../components/UpdatedLine.jsx';
import InsiderDaySummary from '../components/InsiderDaySummary.jsx';
import { TrendingUp, Plus, CircleHelp, ArrowRight, Users, UserSearch } from 'lucide-react';

// The home page: a headline, the search, three tabs — the superinvestors as
// cards (who, firm, last year's return, portfolio size, three largest stocks),
// the insider buys of the week, the stocks the superinvestors agree on — and
// the questions a first visit asks. Everything else (how the numbers are
// computed, where the data comes from) lives on the methodology page the
// footer links.

function useStaticJson(key, file) {
  return useQuery({
    queryKey: [key],
    queryFn: async () => {
      const r = await fetch(file);
      if (!r.ok) return null;
      return r.json();
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 0,
  });
}

// $356B · $24.5B · $980M — a portfolio's size in two or three figures
export function money(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const f = (v, s) => `$${v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1).replace(/\.0$/, '') : v.toFixed(2).replace(/\.?0+$/, '')}${s}`;
  if (n >= 1e12) return f(n / 1e12, 'T');
  if (n >= 1e9) return f(n / 1e9, 'B');
  if (n >= 1e6) return f(n / 1e6, 'M');
  return `$${Math.round(n / 1e3)}K`;
}

const TABS = ['gurus', 'insiders', 'picks'];
const FILTERS = ['popular', 'performance', 'largest', 'value', 'growth', 'activist', 'macro', 'quant'];

function Tabs({ tab, setTab }) {
  const { t } = useI18n();
  return (
    <div className="home-tabs" role="tablist">
      {TABS.map((k) => (
        <button key={k} role="tab" aria-selected={tab === k} className={`home-tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)} data-home-tab={k}>
          {t(`home.tab.${k}`)}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Superinvestor cards

function GuruCard({ g }) {
  const { t } = useI18n();
  const to = managerPath(g.cik, g.slug ? `/guru/${g.slug}` : null);
  const more = Math.max(0, (g.count || 0) - g.top.length);
  return (
    <article className="inv-card" data-guru-card={g.cik}>
      <header className="inv-head">
        <div style={{ minWidth: 0 }}>
          <h3><Link to={to}>{g.person || g.firm}</Link></h3>
          {g.person && <p className="inv-firm">{g.firm}</p>}
        </div>
        <FavoriteButton cik={g.cik} name={g.name} small />
      </header>
      <div className="inv-perf">
        <Ico icon={TrendingUp} size={18} />
        <span>
          {t('home.perf')}:{' '}
          {g.y1 != null ? (
            <b className={deltaClass(g.y1)}>{fmtPct(g.y1)}</b>
          ) : (
            <b className="muted">—</b>
          )}{' '}
          <span className="muted">{t('home.perf.lastYear')}</span>
        </span>
      </div>
      <div className="inv-body">
        <div className="inv-aum">{money(g.aum)} {t('home.portfolio')}</div>
        <ul className="inv-holdings">
          {g.top.map((p) => (
            <li key={p.t}>
              <Link to={`/stock/${p.t}`} className="inv-holding">
                <TickerLogo ticker={p.t} size={40} />
                <span className="inv-holding-name"><CompanyName name={p.n} /></span>
              </Link>
            </li>
          ))}
          {more > 0 && (
            <li>
              <Link to={to} className="inv-holding inv-more">
                <span className="inv-plus"><Ico icon={Plus} size={16} /></span>
                <span className="inv-holding-name">{t('home.moreStocks').replace('{n}', more.toLocaleString())}</span>
              </Link>
            </li>
          )}
        </ul>
      </div>
    </article>
  );
}

function FaqCard() {
  const { t } = useI18n();
  const items = [1, 2, 3, 4, 5].map((n) => [t(`home.faq.q${n}`), t(`home.faq.a${n}`)]);
  return (
    <article className="inv-card faq-card" data-home-faq>
      <header className="inv-head"><h3><Ico icon={CircleHelp} /> {t('seo.faq')}</h3></header>
      <div className="inv-body">
        {items.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
        <Link to={t('home.methodology.path')} className="inv-link">{t('home.methodology')} <Ico icon={ArrowRight} size={14} /></Link>
      </div>
    </article>
  );
}

function GuruGrid({ cards }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState('popular');
  const rows = useMemo(() => {
    const all = cards?.rows || [];
    const has = (f) => (g) => g.category === f;
    switch (filter) {
      case 'performance': return [...all].filter((g) => g.y1 != null).sort((a, b) => b.y1 - a.y1);
      case 'largest': return [...all].sort((a, b) => (b.aum || 0) - (a.aum || 0));
      case 'popular': return all;
      default: return all.filter(has(filter));
    }
  }, [cards, filter]);
  const shown = rows.slice(0, 11);
  return (
    <section aria-label={t('home.tab.gurus')} data-home-gurus>
      <div className="home-filters">
        <span className="muted small">{t('home.filters')}:</span>
        {FILTERS.map((f) => (
          <button key={f} className={`chip sm${filter === f ? ' fsel-active' : ''}`} onClick={() => setFilter(f)} aria-pressed={filter === f} data-filter={f}>
            {t(`home.filter.${f}`)}
          </button>
        ))}
      </div>
      <div className="inv-grid">
        {shown.map((g) => <GuruCard key={g.cik} g={g} />)}
        <FaqCard />
      </div>
      <div className="home-more">
        <Link to="/gurus" className="btn outline">{t('home.allGurus').replace('{n}', String(cards?.count || ''))} <Ico icon={ArrowRight} size={14} /></Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Insider buys of the week — the cluster and C-suite signals the teaser carries

const ROLE = { ceo: 'CEO', cfo: 'CFO', director: 'Director', officer: 'Officer', owner10: '10%' };

function InsiderGrid({ teaser }) {
  const { t, lang } = useI18n();
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const pulse = teaser?.pulse;
  const rows = useMemo(() => {
    const cluster = (teaser?.signals?.cluster || []).map((r) => ({ kind: 'cluster', t: r.t, c: r.c, v: r.v, d: r.last || r.to, who: t('home.ins.nInsiders').replace('{n}', r.insiders), sub: r.ceoCfo ? t('home.ins.withCsuite') : null }));
    const csuite = (teaser?.signals?.csuite || []).map((r) => ({ kind: 'csuite', t: r.t, c: r.c, v: r.v, d: r.d, who: `${ROLE[r.r] || r.r} · ${r.n}`, sub: null }));
    const seen = new Set();
    return [...cluster, ...csuite].filter((r) => r.t && !seen.has(r.t) && seen.add(r.t)).slice(0, 11);
  }, [teaser, t]);
  if (!rows.length) return <p className="muted">{t('common.na')}</p>;
  const day = (iso) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
  return (
    <section aria-label={t('home.tab.insiders')} data-home-insiders>
      <p className="home-lead">{t('home.ins.lead')}</p>
      {/* the same day summary /insiders prints, from the same numbers */}
      {pulse && <div className="card home-pulse"><InsiderDaySummary summary={pulse} /></div>}
      <div className="inv-grid">
        {rows.map((r) => (
          <Link key={r.t} to={`/stock/${r.t}`} className="inv-card pick-card">
            <div className="pick-head">
              <TickerLogo ticker={r.t} size={44} />
              <div style={{ minWidth: 0 }}>
                <b>{r.t}</b>
                <div className="muted small ellipsis"><CompanyName name={r.c} /></div>
              </div>
            </div>
            <div className="pick-stat">
              <span className={`badge ${r.kind === 'cluster' ? 'pos' : 'plain'}`}>{r.kind === 'cluster' ? t('home.ins.cluster') : t('home.ins.csuite')}</span>
              <b className="delta-pos">+{money(r.v)}</b>
            </div>
            <div className="muted small">{r.who}{r.sub ? ` · ${r.sub}` : ''} · {day(r.d)}</div>
          </Link>
        ))}
        <Link to="/insiders" className="inv-card pick-card more-card">
          <Ico icon={UserSearch} size={28} />
          <b>{t('home.ins.all')}</b>
          <span className="muted small">{t('home.ins.allSub')}</span>
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Stock picks — what the superinvestors hold most, and who leads each

function PicksGrid({ consensus, returns }) {
  const { t } = useI18n();
  const rows = (consensus?.mostHeld || []).filter((r) => r.ticker).slice(0, 11);
  const tracked = consensus?.coverage?.tracked;
  if (!rows.length) return <p className="muted">{t('common.na')}</p>;
  return (
    <section aria-label={t('home.tab.picks')} data-home-picks>
      <p className="home-lead">{t('home.picks.lead').replace('{n}', tracked ?? '')}</p>
      <div className="inv-grid">
        {rows.map((r) => {
          const ret = returns?.[r.ticker]?.retYtd;
          const lead = r.holders?.[0];
          return (
            <Link key={r.cusip} to={`/stock/${r.ticker}?cusip=${r.cusip}`} className="inv-card pick-card">
              <div className="pick-head">
                <TickerLogo ticker={r.ticker} size={44} />
                <div style={{ minWidth: 0 }}>
                  <b>{r.ticker}</b>
                  <div className="muted small ellipsis"><CompanyName name={r.coName || r.issuer} /></div>
                </div>
              </div>
              <div className="pick-stat">
                <span><Ico icon={Users} size={14} /> {t('home.picks.holders').replace('{n}', r.holderCount)}</span>
                {ret != null && <b className={deltaClass(ret)}>{fmtPct(ret)} <span className="muted small">YTD</span></b>}
              </div>
              {lead && <div className="muted small ellipsis">{t('home.picks.top')}: {lead.name} ({fmtPct(lead.weight, { sign: false })})</div>}
            </Link>
          );
        })}
        <Link to="/consensus" className="inv-card pick-card more-card">
          <Ico icon={Users} size={28} />
          <b>{t('home.picks.all')}</b>
          <span className="muted small">{t('home.picks.allSub')}</span>
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

export default function Home() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(TABS.includes(params.get('tab')) ? params.get('tab') : 'gurus');
  useSeo(useMemo(() => homeSeo({ lang }), [lang]));

  const cards = useStaticJson('guru-cards', '/guru-cards.json');
  const teaser = useStaticJson('insiders-teaser', '/insiders-teaser.json');
  const consensus = useConsensusStatic();
  const returns = useStaticReturns();
  const funds = fundCountLabel(useUniverseSummary()?.count, { locale: lang === 'tr' ? 'tr-TR' : 'en-US' });

  return (
    <div className="home">
      <section className="home-hero">
        <h1>{t('home.h1')}</h1>
        <p className="lead">{funds ? t('home.sub').replace('{n}', funds) : t('home.sub.noCount')}</p>
        <SearchBox initialText={params.get('q') || ''} onSelect={(m) => navigate(managerPath(m.cik))} placeholder={t('home.search')} />
      </section>

      <Tabs tab={tab} setTab={setTab} />

      {tab === 'gurus' && <GuruGrid cards={cards.data} />}
      {tab === 'insiders' && <InsiderGrid teaser={teaser.data} />}
      {tab === 'picks' && <PicksGrid consensus={consensus.data} returns={returns.data} />}

      <div className="home-source">
        <UpdatedLine updatedAt={consensus.data?.updatedAt} />
        <p className="muted small">{t('home.source')} <Link to={t('home.methodology.path')}>{t('home.methodology')}</Link></p>
      </div>
    </div>
  );
}
