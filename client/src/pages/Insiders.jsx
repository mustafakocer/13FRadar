import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, deltaClass } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useSeo } from '../seo.jsx';
import Paywall from '../components/Paywall.jsx';
import FilterSelect from '../components/FilterSelect.jsx';
import InfoTip from '../components/InfoTip.jsx';
import { SkeletonRows } from '../components/Skeleton.jsx';

const TABS = ['latest', 'ceo', 'cfo', 'cluster', 'penny', 'sells'];
const PERIODS = ['1d', '3d', '1w', '1m', '3m', '1y'];
const VALUE_PRESETS = [
  { v: '10000', k: 'noise' },
  { v: '100000', k: 'notable' },
  { v: '1000000', k: 'high' },
  { v: '10000000', k: 'whale' },
];

const DEFAULT_ADV = { size: '', sector: '', minPrice: '', maxPrice: '', change: '', lagMin: '', lagMax: '', late: false };

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
          <button className="btn ghost" onClick={onClose} aria-label={t('common.close')}>✕</button>
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

export default function Insiders() {
  const { t, lang } = useI18n();
  const { isPro } = useAuth();
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Insider İşlemleri: SEC Form 4 Alım-Satım Akışı | 13F Radar' : 'Insider Trading: SEC Form 4 Buy & Sell Feed | 13F Radar',
        description: lang === 'tr' ? 'CEO, CFO ve yönetim kurulu üyelerinin kendi şirket hisselerindeki açık piyasa alım-satımları; küme alımları, filtreler ve getiri takibi.' : 'Open-market buys and sells by CEOs, CFOs and directors in their own companies; cluster buys, filters and return tracking.',
        path: '/insiders',
      }),
      [lang, t]
    )
  );

  const [tab, setTab] = useState('latest');
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

  const params = useMemo(
    () => ({
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
    }),
    [tab, period, page, sort, search, minValue, adv]
  );

  const feed = useQuery({
    queryKey: ['insider-feed', params],
    queryFn: () => api.insiderFeed(params),
    enabled: isPro,
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
          🕵️ {t('ins.title')} <span className="badge plain">BETA</span>
        </h1>
        <div className="sub">
          {t('ins.subtitle')}
          {feed.data?.updatedAt && ` · ${t('ins.updated')} ${feed.data.updatedAt.slice(0, 10)}`}
        </div>
      </div>
    </div>
  );

  if (!isPro) {
    return (
      <div>
        {header}
        <Paywall />
      </div>
    );
  }

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
                <span className="delta-pos">● {t('ins.purchases')}: {fmtMoney(stats.buyValue)}</span>
                <span className="delta-neg" style={{ marginLeft: 'auto' }}>
                  {t('ins.sells')}: {fmtMoney(stats.sellValue)} ●
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
                <span className={`badge ${r.ret >= 0 ? 'pos' : 'neg'}`}>{r.ret != null ? fmtPct(r.ret) : '—'}</span>
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
            {t('ins.moreFilters')} {advCount ? `(${advCount})` : '⚙'}
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
                    </td>
                    <td className="l">
                      <div>{r.date}</div>
                      <div className="muted small">
                        {t('ins.filed')}: {r.filed}{' '}
                        {r.lag != null && (
                          <span className={r.lag > 2 ? 'delta-neg' : 'muted'}>(+{r.lag}{t('ins.dayShort')})</span>
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
                      <b className={deltaClass(r.ret)}>{r.ret != null ? fmtPct(r.ret) : '0.0%'}</b>
                      <div className="muted small">{t('ins.curr')}: {r.current != null ? `$${fmtNum(r.current, 2)}` : '—'}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
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
