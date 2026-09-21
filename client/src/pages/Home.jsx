import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import SearchBox from '../components/SearchBox.jsx';
import { POPULAR_MANAGERS } from '../data/popular.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import CoverageLine from '../components/CoverageLine.jsx';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useSeo } from '../seo.jsx';
import { homeSeo } from '../lib/seoTemplates.js';
import { fmtMoney, fmtPct, deltaClass, quarterLabel } from '../lib/format.js';
import { managerPath } from '../lib/paths.js';
import { securityLabel } from '../lib/label.js';
import Ico from '../components/Ico.jsx';
import { Folder, Compass, Waves, ChartColumn, Scale, Download, X, Gift, Landmark, Coins, Receipt, Radar, TrendingUp, Zap, Flame, Briefcase, Gem, Trophy, Plus, Star } from 'lucide-react';

// ---------------------------------------------------------------------------
// Landing page. Every block reads a static CDN file written by the daily
// GitHub Actions (consensus.json, insiders-teaser.json, returns.json,
// universe-summary.json) — no API call, no paywall, instant first paint.
// ---------------------------------------------------------------------------

const FEATURES = [
  [Folder, 'f1', '/manager/0001067983'],
  [Compass, 'f2', '/consensus'],
  [Waves, 'f3', '/stock/AAPL'],
  [ChartColumn, 'f4', '/screen'],
  [Scale, 'f5', '/compare'],
  [Download, 'f6', '/watchlist'],
];

const INDEXES = [
  { sym: 'SPY', name: 'S&P 500' },
  { sym: 'QQQ', name: 'Nasdaq 100' },
  { sym: 'IWM', name: 'Russell 2000' },
];

const BANNER_KEY = 'banner.v1.closed';

// "AMAZON COM INC" -> "Amazon Com Inc"
const niceName = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/(^|\s)\S/g, (c) => c.toUpperCase());

const initials = (name) =>
  String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

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

// Compact numbers for the stat band: 7,830+ · $60T+ · 1.2M+
function compact(n, locale) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M+`;
  if (n >= 1e4) return `${(Math.floor(n / 100) * 100).toLocaleString(locale)}+`;
  return n.toLocaleString(locale);
}

const shortDate = (iso, locale) => {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

const daysBetween = (a, b) => {
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
};

// ---------------------------------------------------------------------------

function LangSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t('landing.lang.hint')}>
      {['tr', 'en'].map((l) => (
        <button key={l} className={lang === l ? 'on' : ''} onClick={() => setLang(l)} aria-pressed={lang === l}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function PromoBanner() {
  const { t } = useI18n();
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(BANNER_KEY) === '1') setClosed(true);
    } catch {
      /* storage blocked */
    }
  }, []);
  if (closed) return null;
  const close = () => {
    try {
      localStorage.setItem(BANNER_KEY, '1');
    } catch {
      /* ignore */
    }
    setClosed(true);
  };
  return (
    <div className="promo-banner">
      <Ico icon={Gift} />
      <span>{t('landing.banner')}</span>
      <Link to="/pricing">{t('landing.banner.cta')}</Link>
      <button className="close" onClick={close} aria-label={t('common.close')}>
        <Ico icon={X} />
      </button>
    </div>
  );
}

function Hero({ summary }) {
  const { t, lang } = useI18n();
  const { configured } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';

  const stats = [
    [Landmark, compact(summary?.count, locale) || '7.800+', t('landing.stat.funds2')],
    [Coins, summary?.totalAum ? `$${Math.floor(summary.totalAum / 1e12)}T+` : '$50T+', t('landing.stat.aum')],
    [Receipt, compact(summary?.totalPositions, locale) || '1M+', t('landing.stat.positions')],
    [Radar, t('landing.stat.live.v'), t('landing.stat.live')],
  ];

  return (
    <section className="hero-band">
      <div className="hero-topbar">
        <span className="hero-kicker">SEC 13F · Form 4</span>
        <LangSwitch />
      </div>
      <h1>
        {t('landing.h1.pre')}
        <em>{t('landing.h1.accent')}</em>
        {t('landing.h1.post')}
      </h1>
      <p className="lead">{t('landing.sub')}</p>
      <SearchBox initialText={params.get('q') || ''} onSelect={(m) => navigate(managerPath(m.cik))} />
      <div className="hero-ctas">
        <Link to={configured ? '/account?next=/pricing' : '/pricing'} className="btn">
          {t('landing.cta.start')}
        </Link>
        <Link to="/insiders" className="btn ghost">
          {t('landing.cta.ceo')} ›
        </Link>
      </div>
      <div className="hero-stats">
        {stats.map(([ico, v, label]) => (
          <div className="hero-stat" key={label}>
            <div className="ico"><Ico icon={ico} size={20} /></div>
            <b>{v}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MarketStrip({ returns }) {
  const { t } = useI18n();
  const rows = INDEXES.map((ix) => ({ ...ix, r: returns?.[ix.sym] })).filter((x) => x.r);
  if (!rows.length) return null;
  return (
    <div className="mkt-strip">
      {rows.map((x) => (
        <span key={x.sym}>
          <span className="name">{x.name}</span>
          <span className="sym">{x.sym}</span>
          <span className={deltaClass(x.r.ret1d)}>{fmtPct(x.r.ret1d, { digits: 2 })}</span>
          <span className="ytd">
            {t('landing.mkt.ytd')} <span className={deltaClass(x.r.retYtd)}>{fmtPct(x.r.retYtd)}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

// ---- insider block --------------------------------------------------------

const ROLE_LABEL = { ceo: 'CEO', cfo: 'CFO', director: 'DIR', officer: 'OFF', owner10: '10%' };

function InsiderSignals({ teaser }) {
  const { t, lang } = useI18n();
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const [tab, setTab] = useState('cluster');
  if (!teaser) return null;

  const pulse = teaser.pulse;
  const total = (pulse?.buyValue || 0) + (pulse?.sellValue || 0);
  const buyPct = total > 0 ? (pulse.buyValue / total) * 100 : 50;
  const hl = teaser.highlight;
  const signals = teaser.signals || {};
  // older teaser files only carry `rows`; derive a C-suite list from them
  const list =
    signals[tab] ||
    (tab === 'csuite' ? (teaser.rows || []).filter((r) => r.r === 'ceo' || r.r === 'cfo') : []);

  return (
    <section className="home-section">
      <div className="home-section-head">
        <div>
          <h2>{t('landing.ins.title')}</h2>
          <p>{t('landing.ins.sub')}</p>
        </div>
        <span className="live-pill">
          <i /> {t('landing.ins.live')}
        </span>
      </div>

      <div className="ins-grid">
        <div className="card">
          <div className="pulse-head">
            <div className="ico"><Ico icon={TrendingUp} size={18} /></div>
            <b>{t('landing.ins.pulse')}</b>
          </div>
          <div className="pulse-label">
            {t('landing.ins.sentiment')}
            {pulse?.day && <span>({shortDate(pulse.day, locale)})</span>}
          </div>
          <div className="ins-bar big">
            <div className="buy" style={{ width: `${buyPct}%` }} />
            <div className="sell" style={{ width: `${100 - buyPct}%` }} />
          </div>
          <div className="row ins-bar-legend">
            <span className="delta-pos">
              {t('landing.ins.buys')} {Math.round(buyPct)}%
            </span>
            <span className="delta-neg" style={{ marginLeft: 'auto' }}>
              {t('landing.ins.sells')} {Math.round(100 - buyPct)}%
            </span>
          </div>
          <div className="ins-counts">
            <div className="pos">
              <b>{pulse?.buyCount ?? '—'}</b>
              <span>{t('landing.ins.buys')}</span>
            </div>
            <div className="neg">
              <b>{pulse?.sellCount ?? '—'}</b>
              <span>{t('landing.ins.sells')}</span>
            </div>
            <div className="warn">
              <b>{fmtMoney(pulse?.buyValue)}</b>
              <span>{t('landing.ins.buys')} $</span>
            </div>
          </div>

          {hl && (
            <>
              <div className="hl-kicker">{t('landing.ins.highlight')}</div>
              <Link to={`/stock/${hl.t}`} className="hl-card" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
                <div className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
                  <span className="tick">{hl.t}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="who" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {niceName(hl.n)}
                    </div>
                    <div className="role">
                      {t('landing.ins.insiderBuy')} · {ROLE_LABEL[hl.r] || hl.r}
                    </div>
                  </div>
                  <span className="dot" />
                </div>
                <div className="amt">{fmtMoney(hl.v)}</div>
              </Link>
            </>
          )}
        </div>

        <div className="card">
          <div className="sig-head">
            <b><Ico icon={Zap} /> {t('landing.ins.curated')}</b>
            <div className="seg">
              {['cluster', 'csuite', 'penny'].map((k) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  <Ico icon={k === 'cluster' ? Flame : k === 'csuite' ? Briefcase : Gem} size={14} />
                  {t(`landing.ins.tab.${k}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table className="data sig">
              <thead>
                <tr>
                  <th className="l">{t('landing.ins.th.ticker')}</th>
                  <th className="l">{t('landing.ins.th.signal')}</th>
                  <th className="l">{t('landing.ins.th.window')}</th>
                  <th>{t('landing.ins.th.value')}</th>
                  <th>{t('landing.ins.th.action')}</th>
                </tr>
              </thead>
              <tbody>
                {!list.length && (
                  <tr>
                    <td className="l muted" colSpan={5}>{t('landing.ins.empty')}</td>
                  </tr>
                )}
                {list.slice(0, 5).map((r) =>
                  tab === 'cluster' ? (
                    <tr key={r.t}>
                      <td className="l">
                        <div className="sig-tick">{r.t}</div>
                        <div className="sig-co">{r.c || '—'}</div>
                      </td>
                      <td className="l">
                        <div>
                          {r.insiders} {t('landing.ins.insiders')}
                        </div>
                        <div>
                          {(r.roles || []).map((x) => (
                            <span key={x} className={`role-badge ${x}`}>{ROLE_LABEL[x]}</span>
                          ))}
                        </div>
                      </td>
                      <td className="l">
                        <div>{shortDate(r.last || r.to, locale)}</div>
                        <div className="muted small">
                          {Math.max(1, (daysBetween(r.from, r.to) ?? 0) + 1)} {t('landing.ins.days')}
                        </div>
                      </td>
                      <td className="sig-val">{fmtMoney(r.v)}</td>
                      <td>
                        <Link to={`/stock/${r.t}`} className="btn outline">
                          {t('landing.ins.details')} ›
                        </Link>
                      </td>
                    </tr>
                  ) : (
                    <tr key={`${r.t}-${r.n}`}>
                      <td className="l">
                        <div className="sig-tick">{r.t}</div>
                        <div className="sig-co">{r.c || '—'}</div>
                      </td>
                      <td className="l">
                        <div>
                          <span className={`role-badge ${r.r}`}>{ROLE_LABEL[r.r] || r.r}</span>
                        </div>
                        <div className="muted small" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {niceName(r.n)}
                        </div>
                      </td>
                      <td className="l">
                        <div>{shortDate(r.d, locale)}</div>
                        <div className="muted small">@ ${Number(r.p).toFixed(2)}</div>
                      </td>
                      <td className="sig-val">{fmtMoney(r.v)}</td>
                      <td>
                        <Link to={`/stock/${r.t}`} className="btn outline">
                          {t('landing.ins.details')} ›
                        </Link>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
          {teaser.lastDay && (
            <div className="muted small" style={{ marginTop: 10 }}>
              {t('landing.ins.asOf')}: {teaser.lastDay}
            </div>
          )}
        </div>
      </div>

      <div className="ins-cta">
        <Link to="/insiders" className="btn">
          {t('landing.ins.cta')} →
        </Link>
      </div>
    </section>
  );
}

// ---- guru conviction ------------------------------------------------------

function ConvictionCard({ icon, title, rows, value, sub }) {
  const { t } = useI18n();
  return (
    <div className="card conv-card">
      <h3>
        <span className="ico"><Ico icon={icon} size={18} /></span>
        {title}
      </h3>
      {rows.map((r) => (
        <div className="pos-row" key={r.cusip}>
          <div style={{ minWidth: 0 }}>
            {r.ticker ? (
              <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} className="tick">{r.ticker}</Link>
            ) : (
              <span className="tick" title={r.cusip}>{securityLabel(r).text}</span>
            )}
            <div className="issuer">{niceName(r.issuer)}</div>
          </div>
          <div className="right">
            <div className="w">{value(r)}</div>
            <div className="d muted">{sub(r)}</div>
          </div>
        </div>
      ))}
      <div className="foot">
        <Link to="/consensus">{t('landing.guru.full')}</Link>
      </div>
    </div>
  );
}

function GuruConviction({ mostHeld }) {
  const { t } = useI18n();
  const lists = useMemo(() => {
    const rows = (mostHeld || []).map((r) => ({
      ...r,
      maxWeight: Math.max(0, ...(r.holders || []).map((h) => h.weight || 0)),
    }));
    const gurus = (r) => `${r.holderCount} ${t('landing.guru.gurus')}`;
    return {
      owned: [...rows].sort((a, b) => b.holderCount - a.holderCount || b.totalValue - a.totalValue).slice(0, 5),
      byPct: [...rows].sort((a, b) => b.maxWeight - a.maxWeight).slice(0, 5),
      conviction: rows
        .filter((r) => r.holderCount >= 3)
        .sort((a, b) => b.avgWeight - a.avgWeight)
        .slice(0, 5),
      gurus,
    };
  }, [mostHeld, t]);
  if (!mostHeld?.length) return null;

  return (
    <section className="home-section">
      <div className="home-section-head center">
        <h2>{t('landing.guru.title')}</h2>
        <p>{t('landing.guru.sub')}</p>
      </div>
      <div className="grid grid-3">
        <ConvictionCard
          icon={Trophy}
          title={t('landing.guru.mostOwned')}
          rows={lists.owned}
          value={lists.gurus}
          sub={(r) => fmtMoney(r.totalValue)}
        />
        <ConvictionCard
          icon={Plus}
          title={t('landing.guru.byPct')}
          rows={lists.byPct}
          value={(r) => fmtPct(r.maxWeight, { sign: false, digits: 2 })}
          sub={lists.gurus}
        />
        <ConvictionCard
          icon={Flame}
          title={t('landing.guru.conviction')}
          rows={lists.conviction}
          value={(r) => fmtPct(r.avgWeight, { sign: false, digits: 2 })}
          sub={lists.gurus}
        />
      </div>
    </section>
  );
}

// ---- guru portfolio updates -----------------------------------------------

const UPDATE_ROWS = [
  ['newBuys', 'new', '▲'],
  ['adds', 'add', '▲'],
  ['reduces', 'reduce', '▼'],
  ['exits', 'exit', '▼'],
];

function Chip({ r, kind }) {
  // Four sections of three chips each fit one line per section — and every
  // card is then the same height — only if a chip stays narrow. Two decimals
  // on a +1082.53% move and a two-word issuer name are what pushed rows onto
  // a second line and left the shorter cards with a gap at the bottom.
  const label = r.ticker || niceName(r.issuer).split(' ')[0].slice(0, 12);
  const delta =
    (kind === 'add' || kind === 'reduce') && r.change != null
      ? fmtPct(r.change, { digits: Math.abs(r.change) >= 100 ? 0 : Math.abs(r.change) >= 10 ? 1 : 2 })
      : null;
  const inner = (
    <>
      {label}
      {delta && <small>{delta}</small>}
    </>
  );
  return r.ticker ? (
    <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} className={`tk ${kind}`}>{inner}</Link>
  ) : (
    <span className={`tk ${kind}`}>{inner}</span>
  );
}

function PortfolioUpdates({ updates }) {
  const { t, lang } = useI18n();
  const [all, setAll] = useState(false);
  if (!updates?.length) return null;
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const shown = all ? updates : updates.slice(0, 6);

  return (
    <section className="home-section">
      <div className="home-section-head center">
        <h2>{t('landing.upd.title')}</h2>
        <p>{t('landing.upd.sub')}</p>
      </div>
      <div className="upd-grid">
        {shown.map((u) => (
          <div className="card upd-card" key={u.cik}>
            <div className="head">
              <div className="avatar">{initials(u.manager)}</div>
              <div className="who">
                <Link to={managerPath(u.cik, u.path)} style={{ color: 'inherit' }}>
                  <b>{u.manager}</b>
                </Link>
                <span>CIK {u.cik}</span>
              </div>
              <div className="when">
                <b>{quarterLabel(u.reportDate)}</b>
                <span>{u.filed ? new Date(`${u.filed}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC' }) : ''}</span>
              </div>
            </div>
            {UPDATE_ROWS.map(([key, kind, mark]) => (
              <div className={`upd-row ${kind}`} key={key}>
                <div className="lbl">
                  <i>{mark}</i> {t(`landing.upd.${kind}`)}
                </div>
                <div className="tks">
                  {u[key]?.length ? (
                    u[key].map((r) => <Chip key={r.cusip} r={r} kind={kind} />)
                  ) : (
                    <span className="muted small">{t('landing.upd.none')}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {updates.length > 6 && (
        <div className="upd-more">
          <button className="btn navy" onClick={() => setAll((v) => !v)}>
            {all ? t('landing.upd.less') : t('landing.upd.more')}
          </button>
        </div>
      )}
    </section>
  );
}

// ---- quarterly market activity --------------------------------------------

// The quarter's biggest net buys and sells. The rows are the build's own
// `activity` lists — the head of the same table /rankings/most-bought and
// /rankings/most-sold rank — so the number here is the number there. The
// page used to filter the thirty most-held names by sign instead, which
// was a different list computed in the browser.
function MarketActivity({ activity, mostHeld, managers, coverage, returns }) {
  const { t } = useI18n();
  const [side, setSide] = useState('buys');
  const rows = useMemo(() => {
    if (activity?.[side]?.length) return activity[side].slice(0, 5);
    // a consensus file from before `activity` existed: the old fallback
    const src = mostHeld || [];
    return side === 'buys'
      ? src.filter((r) => r.netValue > 0).sort((a, b) => b.netValue - a.netValue).slice(0, 5)
      : src.filter((r) => r.netValue < 0).sort((a, b) => a.netValue - b.netValue).slice(0, 5);
  }, [activity, mostHeld, side]);
  if (!rows.length) return null;

  const latest = coverage?.quarter || (managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');
  const q = latest ? quarterLabel(latest) : '';

  return (
    <section className="home-section">
      <div className="home-section-head center">
        <h2>
          {q} {t('landing.act.title')}
        </h2>
        <p>{t('landing.act.sub')}</p>
      </div>
      <div className="card act-card">
        <div className="act-tools">
          <div className="seg">
            {['buys', 'sells'].map((s) => (
              <button key={s} className={side === s ? 'on' : ''} onClick={() => setSide(s)}>
                {t(`landing.act.${s}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">{t('table.symbol')}</th>
                <th className="l">{t('table.company')}</th>
                <th>{side === 'buys' ? t('landing.act.netBuy') : t('landing.act.netSell')}</th>
                <th>{t('landing.act.gurus')}</th>
                <th>{t('landing.act.ytd')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ret = r.ticker ? returns?.[r.ticker]?.retYtd : null;
                return (
                  <tr key={r.cusip}>
                    <td className="l">
                      {r.ticker ? (
                        <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 800 }}>{r.ticker}</Link>
                      ) : (
                        <span className="muted small" title={r.cusip}>{securityLabel(r).text}</span>
                      )}
                    </td>
                    <td className="l">{niceName(r.issuer)}</td>
                    <td className={`num ${side === 'buys' ? 'delta-pos' : 'delta-neg'}`}>
                      {fmtMoney(Math.abs(r.netValue))}
                    </td>
                    <td className="num">{side === 'buys' ? r.buyers : r.sellers}</td>
                    <td className={`num ${deltaClass(ret)}`}>{ret != null ? fmtPct(ret) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="upd-more">
          <Link to={`/rankings/${side === 'buys' ? 'most-bought' : 'most-sold'}`} className="btn navy" style={{ textDecoration: 'none' }}>
            {t('landing.act.more')}
          </Link>
        </div>
        <p className="muted small note">{t('landing.act.note')}</p>
        <CoverageLine coverage={coverage} className="muted small note" />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

export default function Home() {
  const { t, lang } = useI18n();
  const { favorites } = useFavorites();
  const qc = useQueryClient();
  useSeo(useMemo(() => homeSeo({ lang }), [lang]));

  const consensus = useConsensusStatic();
  const returns = useStaticReturns();
  const teaser = useStaticJson('insiders-teaser', '/insiders-teaser.json');
  const summary = useStaticJson('universe-summary', '/universe-summary.json');

  // warm the cache while the cursor is still over the chip
  const prefetch = (cik) =>
    qc.prefetchQuery({
      queryKey: ['manager', cik],
      queryFn: () => api.manager(cik),
      staleTime: 30 * 60 * 1000,
    });

  return (
    <div className="home">
      <PromoBanner />
      <Hero summary={summary.data} />
      <MarketStrip returns={returns.data} />

      {favorites.length > 0 && (
        <>
          <div className="section-title"><Ico icon={Star} /> {t('search.favorites')}</div>
          <div className="chip-grid">
            {favorites.map((f) => (
              <Link key={f.cik} to={managerPath(f.cik)} className="chip">
                {f.name}
              </Link>
            ))}
          </div>
        </>
      )}

      <div className="section-title">{t('search.popular')}</div>
      <div className="chip-grid">
        {/* the registry, closed funds last and labelled — never dropped */}
        {[...POPULAR_MANAGERS.filter((m) => !m.activeTo), ...POPULAR_MANAGERS.filter((m) => m.activeTo)].map((m) => (
          <Link key={m.cik} to={managerPath(m.cik)} className={`chip${m.activeTo ? ' muted' : ''}`} onMouseEnter={() => prefetch(m.cik)}>
            {m.name}
            {m.activeTo && <> {t('guru.closed')}</>}
          </Link>
        ))}
      </div>

      <InsiderSignals teaser={teaser.data} />
      <GuruConviction mostHeld={consensus.data?.mostHeld} />
      <PortfolioUpdates updates={consensus.data?.updates} />
      <MarketActivity activity={consensus.data?.activity} mostHeld={consensus.data?.mostHeld} managers={consensus.data?.managers} coverage={consensus.data?.coverage} returns={returns.data} />

      <div className="section-title">{t('landing.features')}</div>
      <div className="grid grid-3 mt16">
        {FEATURES.map(([icon, key, to]) => (
          <Link key={key} to={to} className="card feature-card">
            <div className="feature-icon"><Ico icon={icon} size={28} /></div>
            <h3>{t(`landing.${key}.t`)}</h3>
            <p className="muted small">{t(`landing.${key}.d`)}</p>
          </Link>
        ))}
      </div>

      <div className="section-title">{t('landing.how')}</div>
      <div className="grid grid-3 mt16">
        {[1, 2, 3].map((n) => (
          <div key={n} className="card how-card">
            <div className="how-num">{n}</div>
            <p className="muted">{t(`landing.how${n}`)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
