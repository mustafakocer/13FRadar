import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtNum, fmtPct, deltaClass } from '../lib/format.js';
import { breadcrumbs, faqJsonLd } from '../lib/seoTemplates.js';
import { article, itemList } from '../lib/jsonld.js';
import AnswerBox from '../components/AnswerBox.jsx';
import Faq, { Disclaimer } from '../components/Faq.jsx';
import InfoTip from '../components/InfoTip.jsx';
import Ico from '../components/Ico.jsx';
import { Gem, Users, Sparkles, TriangleAlert } from 'lucide-react';

// /insiders/penny — Penny Stock Insider Gems.
//
// The whole board ships inside the daily teaser file (client/public/
// insiders-teaser.json, seeded server-side), so the page renders complete on
// the first paint with no API call and no paywall: search, role filters and
// sorting all run over those rows in the browser. The live, unabridged feed
// stays Pro at /insiders?tab=penny.
const SIGNALS = ['cluster', 'csuite', 'penny'];
const ROLE_LABEL = { ceo: 'CEO', cfo: 'CFO', director: 'DIR', officer: 'OFF', owner10: '10%' };
const ROLES = ['ceo', 'cfo', 'director', 'owner10'];
// Sort keys. A new position has no percentage change but is the strongest
// possible increase, so it sorts above every percentage.
const SORT_KEY = {
  v: (r) => r.v || 0,
  d: (r) => r.d,
  oc: (r) => (r.nw ? Infinity : r.oc ?? -Infinity),
  p: (r) => r.p ?? 0,
};

const money2 = (v) => (v == null ? '—' : `$${Number(v).toFixed(v < 1 ? 4 : 2)}`);

function Stat({ label, tip, children }) {
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

// One row of the board. Columns that depend on the optional price enrichment
// (current quote, dollar volume) are hidden entirely when no row carries them,
// rather than printing a table of dashes.
function Row({ r, cols, t }) {
  return (
    <tr>
      <td className="l">
        <div className="ins-tick">
          <Link to={`/stock/${r.t}`}>{r.t}</Link>
        </div>
        <div className="muted small ins-co">
          {r.c || '—'}
          {r.sz && <span className="badge plain sm">{t(`size.${r.sz}`)}</span>}
        </div>
      </td>

      <td className="num">
        <b>{money2(r.p)}</b>
        <div className="muted small">{t('penny.cost')}</div>
        {cols.quote && r.px != null && (
          <div className="muted small">
            {t('penny.now')} {money2(r.px)}
            {r.off != null && ` · ${t('penny.offLow')} ${fmtPct(r.off, { digits: 0 })}`}
          </div>
        )}
      </td>

      {cols.volume && (
        <td className="num">
          {r.vol != null ? fmtMoney(r.vol) : '—'}
          <div className="muted small">{t('penny.dollarVolume')}</div>
        </td>
      )}

      <td className="l">
        <div>{r.n}</div>
        {r.ti && <div className="muted small">{r.ti}</div>}
        <div className="small">
          <span className={`role-badge ${r.r}`}>{ROLE_LABEL[r.r] || r.r}</span>
          {r.ins > 1 && (
            <span className="badge sm plain" style={{ marginLeft: 4 }}>
              <Ico icon={Users} size={12} /> {r.ins} {t('penny.insidersShort')}
            </span>
          )}
          {r.plan && <span className="badge sm plain" style={{ marginLeft: 4 }}>10b5-1</span>}
        </div>
      </td>

      <td className="num">
        <b>{fmtMoney(r.v)}</b>
        <div className="muted small">{fmtNum(r.s)} {t('penny.shares')}</div>
      </td>

      <td className="num">
        {r.nw ? (
          <b className="delta-pos">{t('penny.newPosition')}</b>
        ) : r.oc != null ? (
          <b className={deltaClass(r.oc)}>{fmtPct(r.oc, { digits: 1 })}</b>
        ) : (
          <span className="muted">—</span>
        )}
        <div className="muted small">{t('penny.held')}: {fmtNum(r.o)}</div>
      </td>

      {cols.quote && (
        <td className="num">
          <b className={deltaClass(r.ret)}>{r.ret != null ? fmtPct(r.ret) : '—'}</b>
          <div className="muted small">{t('penny.sinceBuy')}</div>
        </td>
      )}

      <td className="l">
        <div>{r.d}</div>
        <div className="muted small">
          {t('penny.filed')}: {r.f}
          {r.lag != null && ` (+${r.lag}${t('ins.dayShort')})`}
          {r.lag > 2 && <span className="badge sm plain" style={{ marginLeft: 4 }}>{t('penny.late')}</span>}
        </div>
      </td>
    </tr>
  );
}

export default function PennyStocks() {
  const { t, lang } = useI18n();
  const teaser = useQuery({
    queryKey: ['insiders-teaser'],
    queryFn: async () => {
      const r = await fetch('/insiders-teaser.json');
      return r.ok ? r.json() : null;
    },
    staleTime: Infinity,
  });
  const board = teaser.data?.penny || null;
  const all = board?.rows || [];
  const st = board?.stats || null;

  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [clusterOnly, setClusterOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [sort, setSort] = useState({ key: 'v', dir: 'desc' });
  const [side, setSide] = useState('buys');

  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const key = SORT_KEY[sort.key];
    const mul = sort.dir === 'desc' ? -1 : 1;
    return all
      .filter((r) => !role || r.r === role)
      .filter((r) => !clusterOnly || r.ins > 1)
      .filter((r) => !newOnly || r.nw)
      .filter(
        (r) =>
          !needle ||
          String(r.t || '').includes(needle) ||
          String(r.c || '').toUpperCase().includes(needle) ||
          String(r.n || '').toUpperCase().includes(needle)
      )
      .slice()
      .sort((a, b) => {
        const x = key(a);
        const y = key(b);
        return x === y ? 0 : (x < y ? -1 : 1) * mul;
      });
  }, [all, q, role, clusterOnly, newOnly, sort]);

  const onSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '');

  // Price enrichment is optional in the pipeline; show only the columns the
  // current dataset can actually fill.
  const cols = useMemo(
    () => {
      const quote = all.some((r) => r.px != null);
      const volume = all.some((r) => r.vol != null);
      // ticker · price · insider · value · holdings · dates, plus the optional two
      return { quote, volume, count: 6 + (quote ? 1 : 0) + (volume ? 1 : 0) };
    },
    [all]
  );
  const filtered = Boolean(q || role || clusterOnly || newOnly);

  const answer = st
    ? lang === 'tr'
      ? `Son ${board.windowDays} günde 5 $ altındaki ${st.companies} hissede ${st.insiders} insider toplam ${fmtMoney(st.buyValue)} tutarında ${fmtNum(st.buyCount)} açık piyasa alımı yaptı; aynı dönemde ${fmtNum(st.sellCount)} satış (${fmtMoney(st.sellValue)}) bildirildi. ${st.clusterCount} şirkette küme alımı var (7 gün içinde en az iki farklı insider). Veri ${board.since} – ${board.through} arası SEC Form 4 bildirimlerinden, 10 bin $ üzeri işlemler.`
      : `Over the last ${board.windowDays} days, ${st.insiders} insiders made ${fmtNum(st.buyCount)} open-market purchases worth ${fmtMoney(st.buyValue)} in ${st.companies} stocks trading under $5, against ${fmtNum(st.sellCount)} sales worth ${fmtMoney(st.sellValue)}. ${st.clusterCount} of those companies show a cluster buy (two or more distinct insiders within 7 days). Source: SEC Form 4 filings from ${board.since} to ${board.through}, trades above $10,000.`
    : null;

  const faq = useMemo(() => {
    if (!st) return [];
    return lang === 'tr'
      ? [
          ['Kuruş hisse insider alımı nedir?', `Şirket yöneticilerinin, yönetim kurulu üyelerinin veya %10 üzeri ortakların, hissesi 5 $'ın altında işlem gören kendi şirketlerinde açık piyasadan (Form 4 işlem kodu P) yaptığı alımlardır. Bu sayfa son ${board.windowDays} gündeki 10 bin $ üzeri alımları listeler.`],
          ['Küme alımı neden önemli?', `Küme alımı, 7 gün içinde en az iki farklı insider'ın aynı şirketten alım yapmasıdır. Tek kişinin alımı kişisel olabilir; birden fazla kişinin aynı anda alması şirket içi ortak bir görüşe işaret eder. Şu an ${st.clusterCount} şirkette küme alımı var.`],
          ['Bu bir yatırım tavsiyesi mi?', 'Hayır. Kuruş hisseler düşük likidite, yüksek volatilite, seyreltme ve borsadan çıkarılma riski taşır. Insider alımı tek başına bir alım sinyali değildir; işlemler 2 iş günü gecikmeyle bildirilir ve fiyat o sırada değişmiş olabilir.'],
        ]
      : [
          ['What is a penny-stock insider buy?', `An open-market purchase (Form 4 transaction code P) by an officer, director or 10% owner in their own company while the stock trades under $5. This page lists such buys above $10,000 from the last ${board.windowDays} days.`],
          ['Why do cluster buys matter?', `A cluster buy is two or more distinct insiders purchasing the same stock within 7 days. One buyer can be personal; several at once points to a shared view inside the company. ${st.clusterCount} companies on this board show one.`],
          ['Is this investment advice?', 'No. Penny stocks carry thin liquidity, high volatility, dilution and delisting risk. An insider buy alone is not a buy signal: trades are reported up to two business days later and the price may already have moved.'],
        ];
  }, [lang, st, board]);

  useSeo(
    useMemo(
      () => ({
        title:
          lang === 'tr'
            ? `Kuruş Hisse Insider Alımları: 5 $ Altı Form 4 Sinyalleri | Fundocap`
            : `Penny Stock Insider Buys: Form 4 Signals Under $5 | Fundocap`,
        description: answer ? answer.slice(0, 155) : undefined,
        answer,
        path: '/insiders/penny',
        dateModified: board?.through || null,
        jsonLd: st
          ? [
              article({
                headline: lang === 'tr' ? 'Kuruş Hisse Insider Alımları' : 'Penny Stock Insider Buys',
                description: answer,
                lang,
                path: '/insiders/penny',
                datePublished: board.since,
                dateModified: board.through,
              }),
              itemList({
                name: lang === 'tr' ? 'Kuruş hisse insider alımları' : 'Penny stock insider buys',
                lang,
                items: all.slice(0, 25).map((r) => ({ name: `${r.t} — ${r.n} — ${fmtMoney(r.v)}`, path: `/stock/${r.t}` })),
              }),
              ...(faq.length ? [faqJsonLd(faq)] : []),
              breadcrumbs(lang, [
                [t('nav.insiders'), '/insiders'],
                [t('landing.ins.tab.penny'), '/insiders/penny'],
              ]),
            ]
          : [],
      }),
      [lang, st, board, answer, faq, all, t]
    )
  );

  const top = side === 'buys' ? board?.top?.buys : board?.top?.sells;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>
            <Ico icon={Gem} size={22} /> {t('penny.title')} <span className="badge plain">BETA</span>
          </h1>
          <div className="sub">
            {t('penny.sub')}
            {board?.through && ` · ${t('landing.ins.asOf')}: ${board.through}`}
          </div>
        </div>
      </div>

      <AnswerBox text={answer} />

      {/* ---- penny-scoped stat cards ------------------------------------ */}
      <div className="grid grid-3">
        <Stat label={`${t('penny.activity')} · ${t('penny.windowLabel').replace('{n}', String(board?.windowDays ?? 30))}`} tip="tips.pennyActivity">
          {st ? (
            <>
              <div className="muted small">
                {fmtNum(st.companies)} {t('penny.companies')} · {fmtNum(st.insiders)} {t('penny.insiders')}
              </div>
              <div className="ins-bar">
                <span className="buy" style={{ width: `${100 - (st.sellShare ?? 50)}%` }} />
                <span className="sell" style={{ width: `${st.sellShare ?? 50}%` }} />
              </div>
              <div className="row ins-bar-legend">
                <span className="delta-pos">{t('ins.purchases')}: {fmtMoney(st.buyValue)}</span>
                <span className="delta-neg" style={{ marginLeft: 'auto' }}>
                  {t('ins.sells')}: {fmtMoney(st.sellValue)}
                </span>
              </div>
              <div className="ins-counts">
                <div className="pos"><b>{fmtNum(st.buyCount)}</b><span>{t('ins.purchases')}</span></div>
                <div className="neg"><b>{fmtNum(st.sellCount)}</b><span>{t('ins.sells')}</span></div>
                <div className="warn"><b>{fmtNum(st.clusterCount)}</b><span>{t('penny.clusters')}</span></div>
              </div>
            </>
          ) : (
            <div className="muted small">{t('common.loading')}</div>
          )}
        </Stat>

        <Stat label={t('ins.highConviction')} tip="tips.pennySignals">
          {!board?.signals?.length && <div className="muted small">{t('common.na')}</div>}
          {board?.signals?.map((s) => (
            <div className="pos-row" key={`${s.t}-${s.kind}`}>
              <div style={{ minWidth: 0 }}>
                <Link to={`/stock/${s.t}`} style={{ fontWeight: 700 }}>{s.t}</Link>
                <div className="muted small">
                  {t(`ins.signal.${s.kind}`)}
                  {s.kind === 'cluster' ? ` (${s.ins})` : ''} · {t('ins.cost')} {money2(s.p)}
                </div>
              </div>
              <div className="right">
                <div className="w">{fmtMoney(s.v)}</div>
                {s.ret != null && <div className={`small ${deltaClass(s.ret)}`}>{fmtPct(s.ret)}</div>}
              </div>
            </div>
          ))}
        </Stat>

        <Stat label={t('ins.topTransactions')}>
          <div className="row" style={{ gap: 6, marginBottom: 8 }}>
            {['buys', 'sells'].map((s) => (
              <button key={s} className={`chip${side === s ? ' fsel-active' : ''}`} onClick={() => setSide(s)}>
                {t(`ins.top.${s}`)}
              </button>
            ))}
          </div>
          {!top?.length && <div className="muted small">{t('common.na')}</div>}
          {top?.map((r) => (
            <div className="pos-row" key={`${r.t}-${r.n}-${r.d}`}>
              <div style={{ minWidth: 0 }}>
                <Link to={`/stock/${r.t}`} style={{ fontWeight: 700 }}>{r.t}</Link>{' '}
                <span className="muted small">{r.n}</span>
                <div className={`small ${side === 'buys' ? 'delta-pos' : 'delta-neg'}`}>
                  {fmtMoney(r.v)} · {t('ins.avg')} {money2(r.p)}
                </div>
              </div>
              <div className="right">
                <span className="badge plain">{fmtNum(r.s)}</span>
              </div>
            </div>
          ))}
        </Stat>
      </div>

      {/* ---- sibling signal boards --------------------------------------- */}
      <div className="row" style={{ gap: 6, margin: '16px 0' }}>
        {SIGNALS.map((k) => (
          <Link key={k} to={`/insiders/${k}`} className={`chip${k === 'penny' ? ' fsel-active' : ''}`}>
            {t(`landing.ins.tab.${k}`)}
          </Link>
        ))}
        <Link to="/insiders?tab=penny" className="chip">{t('penny.liveFeed')} →</Link>
      </div>

      {/* ---- board toolbar ---------------------------------------------- */}
      <div className="card ins-toolbar">
        <input
          className="search-input sm"
          placeholder={t('ins.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('ins.searchPlaceholder')}
        />
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className={`chip${role === '' ? ' fsel-active' : ''}`} onClick={() => setRole('')}>
            {t('screen.all')}
          </button>
          {ROLES.map((r) => (
            <button key={r} className={`chip${role === r ? ' fsel-active' : ''}`} onClick={() => setRole(r)}>
              {ROLE_LABEL[r]}
            </button>
          ))}
          <button
            className={`chip${clusterOnly ? ' fsel-active' : ''}`}
            onClick={() => setClusterOnly((v) => !v)}
            aria-pressed={clusterOnly}
          >
            <Ico icon={Users} size={14} /> {t('penny.clusterOnly')}
          </button>
          <button
            className={`chip${newOnly ? ' fsel-active' : ''}`}
            onClick={() => setNewOnly((v) => !v)}
            aria-pressed={newOnly}
          >
            <Ico icon={Sparkles} size={14} /> {t('penny.newOnly')}
          </button>
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {fmtNum(rows.length)} / {fmtNum(all.length)} {t('ins.results')}
          </span>
          {filtered && (
            <button
              className="btn ghost sm"
              onClick={() => { setQ(''); setRole(''); setClusterOnly(false); setNewOnly(false); }}
            >
              {t('screen.reset')}
            </button>
          )}
        </div>
      </div>

      {/* ---- board ------------------------------------------------------- */}
      <div className="card mt16">
        <div className="table-wrap">
          <table className="data ins-table">
            <thead>
              <tr>
                <th className="l">{t('landing.ins.th.ticker')}</th>
                <th className="sortable" onClick={() => onSort('p')}>
                  {t('penny.th.price')}{arrow('p')}
                </th>
                {cols.volume && (
                  <th>
                    {t('penny.th.volume')}
                    <InfoTip tip="tips.pennyVolume" />
                  </th>
                )}
                <th className="l">{t('ins.insider')}</th>
                <th className="sortable" onClick={() => onSort('v')}>
                  {t('penny.th.value')}{arrow('v')}
                </th>
                <th className="sortable" onClick={() => onSort('oc')}>
                  {t('penny.th.holdings')}
                  <InfoTip tip="tips.pennyHoldings" />{arrow('oc')}
                </th>
                {cols.quote && <th>{t('ins.return')}</th>}
                <th className="l sortable" onClick={() => onSort('d')}>
                  {t('ins.dates')}
                  <InfoTip tip="tips.insDates" />{arrow('d')}
                </th>
              </tr>
            </thead>
            <tbody>
              {!rows.length && (
                <tr>
                  <td className="l muted" colSpan={cols.count}>
                    {all.length ? t('ins.noResults') : t('landing.ins.empty')}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <Row key={`${r.t}-${r.n}-${r.d}`} r={r} cols={cols} t={t} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small mt16">
          <Ico icon={TriangleAlert} size={14} /> {t('penny.risk')}
        </p>
      </div>

      {/* ---- the unabridged feed lives behind Pro ------------------------- */}
      <div className="card mt16 row" style={{ justifyContent: 'space-between', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <b>{t('penny.moreTitle')}</b>
          <div className="muted small">
            {t('penny.moreSub').replace('{n}', String(st ? fmtNum(st.buyCount) : '—')).replace('{k}', String(all.length))}
          </div>
        </div>
        <Link to="/insiders?tab=penny" className="btn" style={{ textDecoration: 'none', flexShrink: 0 }}>
          {t('penny.liveFeed')}
        </Link>
      </div>

      <Faq items={faq} />
      <p className="muted small mt16">{t('ins.note')}</p>
      <Disclaimer />
    </div>
  );
}
