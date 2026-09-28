import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { dataFreshness } from '../lib/secCalendar.js';
import { fmtMoney, fmtNum, fmtPct, deltaClass } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useSeo } from '../seo.jsx';
import ProGate from '../components/ProGate.jsx';
import { dataset, webPage } from '../lib/jsonld.js';
import FilterSelect from '../components/FilterSelect.jsx';
import InfoTip from '../components/InfoTip.jsx';
import { SkeletonRows } from '../components/Skeleton.jsx';
import Ico from '../components/Ico.jsx';
import { X, UserSearch, SlidersHorizontal } from 'lucide-react';

const TABS = ['latest', 'ceo', 'cfo', 'cluster', 'penny', 'sells'];
const PERIODS = ['1d', '3d', '1w', '1m', '3m', '1y'];
const VALUE_PRESETS = [
  { v: '10000', k: 'noise' },
  { v: '100000', k: 'notable' },
  { v: '1000000', k: 'high' },
  { v: '10000000', k: 'whale' },
];

const DEFAULT_ADV = { size: '', sector: '', minPrice: '', maxPrice: '', change: '', lagMin: '', lagMax: '', late: false, other: false, excludePlanned: false, codes: '', clusterMin: '', density: '' };

// Form 4 transaction codes worth asking for by name. The three broad classes
// answer "is this conviction or housekeeping"; these answer "was it an
// exercise-and-hold or an outright purchase", which the classes flatten.
const CODE_CHOICES = ['P', 'S', 'C', 'M', 'X', 'D', 'A', 'F', 'G', 'W', 'J', 'I', 'L'];
const DENSITIES = ['blitz', 'tight', 'standard', 'extended'];

function Stat({ label, children, tip }) {
  return (
    <div className="card ins-stat">
      <h3>
        {label}
        {tip && <InfoTip tip={tip} />}
      </h3>
      {children}
    </div>
  );
}

// Advanced filters live in a dialog so the toolbar stays one line.
function AdvancedDialog({ open, onClose, value, onApply, sectors, t }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  if (!open) return null;
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{t('ins.advanced')}</h3>
          <button className="btn ghost" onClick={onClose} aria-label={t('common.close')}><Ico icon={X} /></button>
        </div>
        <div className="grid grid-2 mt16 modal-cols">
          <div>
            <div className="modal-legend">{t('ins.companyProfile')}</div>
            <label className="field">
              <span>{t('screen.size')}</span>
              <select className="select" value={draft.size} onChange={(e) => set('size', e.target.value)}>
                <option value="">{t('screen.all')}</option>
                {['mega', 'large', 'mid', 'small', 'micro'].map((s) => (
                  <option key={s} value={s}>{t(`size.${s}`)}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('ins.sector')}</span>
              <select className="select" value={draft.sector} onChange={(e) => set('sector', e.target.value)}>
                <option value="">{t('screen.all')}</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <div className="modal-legend" style={{ marginTop: 18 }}>{t('ins.tradeTypes')}</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {CODE_CHOICES.map((c) => {
                const picked = draft.codes.split(',').filter(Boolean);
                const on = picked.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className={`chip sm${on ? ' fsel-active' : ''}`}
                    title={t(`ins.code.${c}`)}
                    onClick={() =>
                      set('codes', (on ? picked.filter((x) => x !== c) : [...picked, c]).join(','))
                    }
                  >
                    {c} · {t(`ins.code.${c}`)}
                  </button>
                );
              })}
            </div>
            <label className="field">
              <span>{t('ins.priceRange')}</span>
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <input className="search-input sm" placeholder={t('ins.min')} value={draft.minPrice} onChange={(e) => set('minPrice', e.target.value)} />
                <span className="muted">–</span>
                <input className="search-input sm" placeholder={t('ins.max')} value={draft.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} />
              </div>
            </label>
          </div>
          <div>
            <div className="modal-legend">{t('ins.signalQuality')}</div>
            <label className="field">
              <span>{t('ins.positionChange')}</span>
              <select className="select" value={draft.change} onChange={(e) => set('change', e.target.value)}>
                <option value="">{t('ins.change.any')}</option>
                <option value="new">{t('ins.change.new')}</option>
                <option value="inc10">{t('ins.change.inc10')}</option>
                <option value="inc50">{t('ins.change.inc50')}</option>
                <option value="inc100">{t('ins.change.inc100')}</option>
              </select>
            </label>
            <div className="modal-legend" style={{ marginTop: 18 }}>{t('ins.timeliness')}</div>
            <label className="field">
              <span>{t('ins.filingLag')}</span>
              <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                <input className="search-input sm" placeholder={t('ins.min')} value={draft.lagMin} onChange={(e) => set('lagMin', e.target.value)} />
                <span className="muted">–</span>
                <input className="search-input sm" placeholder={t('ins.max')} value={draft.lagMax} onChange={(e) => set('lagMax', e.target.value)} />
              </div>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={draft.late} onChange={(e) => set('late', e.target.checked)} />
              <span>
                <b>{t('ins.includeLate')}</b>
                <span className="muted small"> — {t('ins.includeLateNote')}</span>
              </span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={draft.other} onChange={(e) => set('other', e.target.checked)} />
              <span>
                <b>{t('ins.showOther')}</b>
                <span className="muted small"> — {t('ins.showOtherNote')}</span>
              </span>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={draft.excludePlanned} onChange={(e) => set('excludePlanned', e.target.checked)} />
              <span>
                <b>{t('ins.excludePlanned')}</b>
                <span className="muted small"> — {t('ins.excludePlannedNote')}</span>
              </span>
            </label>
            <div className="modal-legend" style={{ marginTop: 18 }}>{t('ins.clusterShape')}</div>
            <label className="field">
              <span>{t('ins.clusterSize')}</span>
              <select className="select" value={draft.clusterMin} onChange={(e) => set('clusterMin', e.target.value)}>
                <option value="">{t('screen.all')}</option>
                <option value="2">2+</option>
                <option value="3">3+</option>
                <option value="5">5+</option>
              </select>
            </label>
            <label className="field">
              <span>{t('ins.density')}</span>
              <select className="select" value={draft.density} onChange={(e) => set('density', e.target.value)}>
                <option value="">{t('screen.all')}</option>
                {DENSITIES.map((d) => (
                  <option key={d} value={d}>{t(`ins.density.${d}`)}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="row mt16" style={{ justifyContent: 'flex-end' }}>
          <button className="btn ghost" onClick={() => setDraft(DEFAULT_ADV)}>{t('screen.reset')}</button>
          <button className="btn" onClick={() => { onApply(draft); onClose(); }}>{t('ins.applyFilters')}</button>
        </div>
      </div>
    </div>
  );
}

// The label under an insider's name: the signal level for an open-market
// buy (Güçlü / Orta / Zayıf / Sinyal yok, the reason in the tooltip), the
// kind of transaction for everything else ("Opsiyon kullanımı", "Vergi
// kesintisi"…), and "Büyük ortak (fon)" for funds and pure 10% owners.
// Rules: api/_lib/insiderSignal.js.
const LEVEL_CLASS = { strong: 'pos', medium: 'info', weak: 'plain', none: 'plain' };
export function signalReason(sig, t) {
  if (!sig) return '';
  if (sig.level === 'none') return t(`ins.why.${sig.why}`);
  const parts = [t(`ins.role.${sig.role}`)];
  if (sig.value != null) parts.push(fmtMoney(sig.value));
  if (sig.ownIncrease === 'new') parts.push(t('ins.newPosition'));
  else if (sig.ownIncrease != null) parts.push(`${t('ins.own')} ${fmtPct(sig.ownIncrease, { digits: 0 })}`);
  if (sig.why === 'large_holder_cap') parts.push(t('ins.why.large_holder_cap'));
  return parts.join(' · ');
}
function RowLabel({ r, t }) {
  const planned = r.planned && <span className="badge sm plain" style={{ marginLeft: 4 }}>10b5-1</span>;
  const holder = r.largeHolder && <span className="badge sm plain" style={{ marginLeft: 4 }}>{t('ins.largeHolder')}</span>;
  if (r.category === 'open_buy') {
    const level = r.signal?.level || 'none';
    return (
      <>
        <span className={`badge sm ${LEVEL_CLASS[level]}`} title={signalReason(r.signal, t)} data-level={level}>
          {t(`ins.level.${level}`)}
        </span>
        {holder}
        {planned}
      </>
    );
  }
  return (
    <>
      <span className={`badge sm ${r.category === 'open_sell' ? 'neg' : 'plain'}`} title={r.code ? `Form 4: ${r.code}` : undefined} data-category={r.category}>
        {t(`ins.cat.${r.category || 'other'}`)}
      </span>
      {holder}
      {planned}
    </>
  );
}

export default function Insiders() {
  const { t, lang } = useI18n();
  const { isPro } = useAuth();
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Insider İşlemleri: SEC Form 4 Alım-Satım Akışı | Fundocap' : 'Insider Trading: SEC Form 4 Buy & Sell Feed | Fundocap',
        description: lang === 'tr' ? 'CEO, CFO ve yönetim kurulu üyelerinin kendi şirket hisselerindeki açık piyasa alım-satımları; küme alımları, filtreler ve getiri takibi.' : 'Open-market buys and sells by CEOs, CFOs and directors in their own companies; cluster buys, filters and return tracking.',
        path: '/insiders',
        jsonLd: [
          webPage({ name: lang === 'tr' ? 'Insider İşlemleri' : 'Insider Trading', lang, path: '/insiders' }),
          dataset({
            name: lang === 'tr' ? 'SEC Form 4 insider işlemleri akışı' : 'SEC Form 4 insider transactions feed',
            description:
              lang === 'tr'
                ? 'ABD borsalarında CEO, CFO, yönetim kurulu üyesi ve %10 ortakların kendi şirket hisselerindeki açık piyasa alım-satımları; SEC Form 4 bildirimlerinden günlük derlenir, küme alımları ve işlem başına getiri ile.'
                : 'Open-market buys and sells by CEOs, CFOs, directors and 10% owners in their own companies, compiled daily from SEC Form 4 filings, with cluster buys and per-trade returns.',
            lang,
            path: '/insiders',
            keywords: ['Form 4', 'insider trading', 'SEC EDGAR', 'cluster buys'],
          }),
        ],
      }),
      [lang, t]
    )
  );

  // The tab lives in the URL so /insiders?tab=penny is linkable — the penny
  // board at /insiders/penny hands its readers straight to the live feed.
  const [sp, setSp] = useSearchParams();
  const tab = TABS.includes(sp.get('tab')) ? sp.get('tab') : 'latest';
  const setTab = (k) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (k === 'latest') next.delete('tab');
        else next.set('tab', k);
        return next;
      },
      { replace: true }
    );
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('1y');
  const [minValue, setMinValue] = useState('');
  const [adv, setAdv] = useState(DEFAULT_ADV);
  const [advOpen, setAdvOpen] = useState(false);
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [topSide, setTopSide] = useState('buys');

  useEffect(() => {
    const id = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => setPage(1), [tab, search, period, minValue, adv, sort]);

  // A free reader's query is the preview the server rendered — the tab and
  // nothing else — so the HTML's rows are what hydrates; a Pro reader's
  // carries every filter and asks for the full feed.
  const params = useMemo(
    () => (!isPro ? { tab } : {
      full: '1',
      tab,
      period,
      page: String(page),
      sort: sort.key,
      dir: sort.dir,
      ...(search ? { q: search } : {}),
      ...(minValue ? { minValue } : {}),
      ...(adv.size ? { size: adv.size } : {}),
      ...(adv.sector ? { sector: adv.sector } : {}),
      ...(adv.minPrice ? { minPrice: adv.minPrice } : {}),
      ...(adv.maxPrice ? { maxPrice: adv.maxPrice } : {}),
      ...(adv.change ? { change: adv.change } : {}),
      ...(adv.lagMin ? { lagMin: adv.lagMin } : {}),
      ...(adv.lagMax ? { lagMax: adv.lagMax } : {}),
      ...(adv.late ? { late: '1' } : {}),
      ...(adv.other ? { types: 'all' } : {}),
      ...(adv.excludePlanned ? { excludePlanned: '1' } : {}),
      ...(adv.codes ? { codes: adv.codes } : {}),
      ...(adv.clusterMin ? { clusterMin: adv.clusterMin } : {}),
      ...(adv.density ? { density: adv.density } : {}),
    }),
    [isPro, tab, period, page, sort, search, minValue, adv]
  );


  const feed = useQuery({
    queryKey: ['insider-feed', params],
    queryFn: () => api.insiderFeed(params),
    placeholderData: keepPreviousData,
    staleTime: 30 * 60 * 1000,
    retry: 0,
  });

  const [sectors, setSectors] = useState([]);
  const [stats, setStats] = useState(null);
  useEffect(() => {
    if (feed.data?.sectors) setSectors(feed.data.sectors);
    if (feed.data?.stats) setStats(feed.data.stats);
  }, [feed.data]);

  const advCount = Object.entries(adv).filter(([, v]) => v && v !== '').length;
  const rows = feed.data?.rows || [];
  const total = feed.data?.total || 0;
  const pages = Math.ceil(total / (feed.data?.perPage || 50));

  const onSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '');

  const header = (
    <div className="page-head">
      <div>
        <h1>
          <Ico icon={UserSearch} size={22} /> {t('ins.title')} <span className="badge plain">BETA</span>
        </h1>
        <div className="sub">
          {t('ins.subtitle')}
          {/* the newest filing date in the rows, never the file's write time:
              "Güncelleme <date>" while live, "Son veri: <date>" once it is
              more than one business day behind */}
          {feed.data?.lastFilingDay &&
            (dataFreshness(feed.data.lastFilingDay).live
              ? ` · ${t('ins.updated')} ${feed.data.lastFilingDay}`
              : ` · ${t('data.latest')}: ${feed.data.lastFilingDay}`)}
        </div>
      </div>
    </div>
  );

  const preview = Boolean(feed.data?.preview) || (!isPro && !feed.data);

  return (
    <div>
      {header}

      {/* ---- signal cards ------------------------------------------------ */}
      <div className="grid grid-3">
        <Stat label={`${t('ins.marketActivity')}${stats?.day ? ` (${stats.day.slice(5)})` : ''}`} tip="tips.insActivity">
          {stats ? (
            <>
              <div className="muted small">{fmtNum(stats.companies)} {t('ins.companies')}</div>
              <div className="ins-bar">
                <span className="buy" style={{ width: `${100 - (stats.sellShare ?? 50)}%` }} />
                <span className="sell" style={{ width: `${stats.sellShare ?? 50}%` }} />
              </div>
              <div className="row ins-bar-legend">
                <span className="delta-pos">{t('ins.purchases')}: {fmtMoney(stats.buyValue)}</span>
                <span className="delta-neg" style={{ marginLeft: 'auto' }}>
                  {t('ins.sells')}: {fmtMoney(stats.sellValue)}
                </span>
              </div>
              <div className="ins-counts">
                <div className="pos"><b>{fmtNum(stats.buyCount)}</b><span>{t('ins.purchases')}</span></div>
                <div className="neg"><b>{fmtNum(stats.sellCount)}</b><span>{t('ins.sells')}</span></div>
                <div className="warn">
                  <b>{stats.sellShare != null ? `${Math.round(stats.sellShare)}%` : '—'}</b>
                  <span>{t('ins.sellShare')}</span>
                </div>
              </div>
            </>
          ) : (
            <div className="muted small">{t('common.loading')}</div>
          )}
        </Stat>

        <Stat label={t('ins.highConviction')} tip="tips.insSignals">
          {!stats?.signals?.length && <div className="muted small">{t('common.na')}</div>}
          {stats?.signals?.map((s) => (
            <div className="pos-row" key={`${s.ticker}-${s.kind}`}>
              <div>
                <Link to={`/stock/${s.ticker}`} style={{ fontWeight: 700 }}>{s.ticker}</Link>
                <div className="muted small">
                  {s.level && s.level !== 'none' && <span className={`badge sm ${LEVEL_CLASS[s.level]}`} style={{ marginRight: 4 }}>{t(`ins.level.${s.level}`)}</span>}
                  {t(`ins.signal.${s.kind}`)}
                  {s.kind === 'cluster' ? ` (${s.insiders})` : ''} · {t('ins.cost')} {fmtNum(s.price, 2)}
                </div>
              </div>
              <div className="right">
                <span className={`w ${deltaClass(s.ret)}`}>{s.ret != null ? fmtPct(s.ret) : '—'}</span>
                <div className="muted small">{t('ins.return')}</div>
              </div>
            </div>
          ))}
        </Stat>

        <Stat label={t('ins.topTransactions')}>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            {['buys', 'sells'].map((s) => (
              <button key={s} className={`chip${topSide === s ? ' fsel-active' : ''}`} onClick={() => setTopSide(s)}>
                {t(`ins.top.${s}`)}
              </button>
            ))}
          </div>
          {(topSide === 'buys' ? stats?.topBuys : stats?.topSells)?.map((r, i) => (
            <div className="pos-row" key={`${r.ticker}-${i}`}>
              <div style={{ minWidth: 0 }}>
                <Link to={`/stock/${r.ticker}`} style={{ fontWeight: 700 }}>{r.ticker}</Link>{' '}
                <span className="muted small">{r.insider}</span>
                <div className={`small ${topSide === 'buys' ? 'delta-pos' : 'delta-neg'}`}>
                  {topSide === 'buys' ? '+' : '−'}{fmtMoney(Math.abs(r.value || 0))} · {t('ins.avg')} {fmtNum(r.price, 2)}
                </div>
              </div>
              <div className="right">
                <span className={`badge ${r.ret == null ? 'plain' : r.ret >= 0 ? 'pos' : 'neg'}`}>
                  {r.ret != null ? fmtPct(r.ret) : '—'}
                </span>
              </div>
            </div>
          )) || <div className="muted small">{t('common.na')}</div>}
        </Stat>
      </div>

      {/* ---- tabs -------------------------------------------------------- */}
      <div className="tabs">
        {TABS.map((k) => (
          <button key={k} className={`tab${tab === k ? ' active' : ''}`} onClick={() => setTab(k)}>
            {t(`ins.tab.${k}`)}
          </button>
        ))}
      </div>

      {/* ---- toolbar ----------------------------------------------------- */}
      <div className="card ins-toolbar">
        {!isPro && (
          <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'center' }}>
            <span className="badge pro sm">PRO</span>
            <span className="muted small">{t('paywall.filtersPro')}</span>
            <Link to="/pricing" className="btn ghost sm" style={{ marginLeft: 'auto', textDecoration: 'none' }}>{t('paywall.cta')}</Link>
          </div>
        )}
        <fieldset disabled={!isPro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: isPro ? 1 : 0.55 }}>
        <input
          className="search-input sm"
          placeholder={t('ins.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <FilterSelect
            label={t('ins.period')}
            value={period === '1y' ? '' : period}
            onChange={(v) => setPeriod(v || '1y')}
            options={[{ v: '', label: t('ins.period.1y') }, ...PERIODS.filter((p) => p !== '1y').map((p) => ({ v: p, label: t(`ins.period.${p}`) }))]}
          />
          <FilterSelect
            label={t('ins.value')}
            value={minValue}
            onChange={setMinValue}
            options={[
              { v: '', label: t('screen.all') },
              ...VALUE_PRESETS.map((p) => ({ v: p.v, label: t(`ins.value.${p.k}`) })),
            ]}
          />
          <button className={`chip${advCount ? ' fsel-active' : ''}`} onClick={() => setAdvOpen(true)}>
            <Ico icon={SlidersHorizontal} /> {t('ins.moreFilters')}{advCount ? ` (${advCount})` : ''}
          </button>
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {fmtNum(total)} {t('ins.results')}
          </span>
          {(advCount || minValue || search || period !== '1y') && (
            <button
              className="btn ghost sm"
              onClick={() => { setAdv(DEFAULT_ADV); setMinValue(''); setQ(''); setPeriod('1y'); }}
            >
              {t('screen.reset')}
            </button>
          )}
        </div>
        </fieldset>
      </div>

      {/* ---- table ------------------------------------------------------- */}
      {feed.isError && (
        <div className="error-box mt16">{t('common.error')}: {String(feed.error.message)}</div>
      )}
      {feed.data?.empty && <div className="card mt16 muted">{t('ins.building')}</div>}
      {feed.isLoading && <div className="mt16"><SkeletonRows rows={8} /></div>}

      {!feed.isLoading && rows.length > 0 && (
        <div className="card mt16">
          <div className="table-wrap">
            <table className="data ins-table">
              <thead>
                <tr>
                  <th className="l" onClick={() => onSort('date')}>{t('table.symbol')}</th>
                  <th className="l">{t('ins.insider')}</th>
                  <th className="l" onClick={() => onSort('date')}>{t('ins.dates')}<InfoTip tip="tips.insDates" />{arrow('date')}</th>
                  <th onClick={() => onSort('value')}>{t('ins.valuePrice')}{arrow('value')}</th>
                  <th onClick={() => onSort('shares')}>{t('ins.sharesOwn')}{arrow('shares')}</th>
                  <th onClick={() => onSort('return')}>{t('ins.returnCurr')}<InfoTip tip="tips.insReturn" />{arrow('return')}</th>
                  <th>{t('ins.winRate')}<InfoTip tip="ins.winRateTip" /></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.ticker}-${r.insider}-${r.date}-${i}`} className={r.side === 'buy' ? 'ins-buy' : ''}>
                    <td className="l">
                      <div className="ins-tick">
                        {r.ticker ? <Link to={`/stock/${r.ticker}`}>{r.ticker}</Link> : <span className="muted">—</span>}
                      </div>
                      <div className="muted small ins-co">
                        {r.company}
                        {r.size && <span className="badge plain sm">{t(`size.${r.size}`)}</span>}
                      </div>
                    </td>
                    <td className="l">
                      <div>{r.insider}</div>
                      {r.title && <div className="muted small">{r.title}</div>}
                      <div className="small">
                        <RowLabel r={r} t={t} />
                        {r.cluster && (
                          <span
                            className="badge sm pos"
                            style={{ marginLeft: 4 }}
                            title={`${r.cluster.from} → ${r.cluster.to} · ${t(`ins.density.${r.cluster.density}`)}`}
                          >
                            {t('ins.clusterOf').replace('{n}', r.cluster.insiders)}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="l">
                      <div>{r.date}</div>
                      <div className="muted small">
                        {t('ins.filed')}: {r.filed}{' '}
                        {r.lag != null && (
                          <span className="muted">(+{r.lag}{t('ins.dayShort')})</span>
                        )}
                      </div>
                    </td>
                    <td className="num">
                      <b>{r.value != null ? `$${fmtNum(r.value, 2)}` : '—'}</b>
                      <div className="muted small">{t('ins.price')}: {r.price != null ? `$${fmtNum(r.price, 2)}` : '—'}</div>
                    </td>
                    <td className="num">
                      <div>
                        {fmtNum(r.shares)}{' '}
                        {r.ownChange != null && (
                          <span className={deltaClass(r.ownChange)}>({fmtPct(r.ownChange, { digits: 1 })})</span>
                        )}
                      </div>
                      <div className="muted small">{t('ins.held')}: {fmtNum(r.owned)}</div>
                    </td>
                    <td className="num">
                      {r.ret != null ? (
                        <b className={deltaClass(r.ret)}>{fmtPct(r.ret)}</b>
                      ) : (
                        <b className="muted" title={r.category === 'open_buy' || r.category === 'open_sell' ? undefined : t('ins.noReturn')}>—</b>
                      )}
                      <div className="muted small">{t('ins.curr')}: {r.current != null ? `$${fmtNum(r.current, 2)}` : '—'}</div>
                    </td>
                    <td className="num">
                      {r.hitRate && !r.hitRate.insufficient ? (
                        <>
                          <b>{fmtPct(r.hitRate.rate, { sign: false, digits: 0 })}</b>
                          {/* the sample size travels with the rate: 100% of three
                              buys is not the same claim as 60% of fifteen */}
                          <div className="muted small">n={r.hitRate.n}</div>
                        </>
                      ) : r.hitRate?.insufficient ? (
                        <span className="muted small" title={`n=${r.hitRate.n}`}>{t('ins.hitInsufficient')}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!preview && pages > 1 && (
            <div className="row mt16" style={{ justifyContent: 'center', gap: 10 }}>
              <button className="btn ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← {t('ins.prev')}</button>
              <span className="muted small">{page} / {pages}</span>
              <button className="btn ghost" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('ins.next')} →</button>
            </div>
          )}
        </div>
      )}
      {!feed.isLoading && !feed.isError && !rows.length && !feed.data?.empty && (
        <div className="card mt16 muted">{t('ins.noResults')}</div>
      )}
      {preview && feed.data && (
        <ProGate remaining={Math.max(0, total - rows.length)} unit={t('paywall.unit.trades')} note={t('paywall.previewFeed')} />
      )}

      <p className="muted small mt16">{t('ins.note')}</p>

      <AdvancedDialog
        open={advOpen}
        onClose={() => setAdvOpen(false)}
        value={adv}
        onApply={setAdv}
        sectors={sectors}
        t={t}
      />
    </div>
  );
}
