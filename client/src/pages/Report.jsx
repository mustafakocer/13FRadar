import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { fmtMoney, fmtNum, fmtPct, deltaClass, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { useAuth } from '../auth.jsx';
import { breadcrumbs, faqJsonLd } from '../lib/seoTemplates.js';
import { article, itemList } from '../lib/jsonld.js';
import AnswerBox from '../components/AnswerBox.jsx';
import Faq, { Disclaimer } from '../components/Faq.jsx';
import Paywall from '../components/Paywall.jsx';
import InfoTip from '../components/InfoTip.jsx';
import GuruActivityBars from '../components/GuruActivityBars.jsx';
import FilterSelect from '../components/FilterSelect.jsx';
import { managerPath } from '../lib/paths.js';
import { CAPS, capBucket, consensusOf, isFresh, pctChange } from '../../../api/_lib/guruActivity.js';
import Ico from '../components/Ico.jsx';
import { Newspaper, Crown, Flame, Landmark } from 'lucide-react';

// /report — what the tracked superinvestors bought and sold, quarter by
// quarter, as one filterable table.
//
// The rows come from client/public/guru-activity.json, a per-quarter pivot of
// guru-history.json (see scripts/build-guru-activity.mjs). Every filter and
// sort runs in the browser over the selected quarter, so switching a filter
// costs nothing and the page needs no API.
const SIDES = ['buys', 'sells'];
const KINDS = ['all', 'stock', 'etf'];

const Sym = ({ t }) => (
  <Link to={`/stock/${t}`} className="ins-tick">
    {t}
  </Link>
);

export default function Report() {
  const { t, lang } = useI18n();
  const { isPro } = useAuth();
  const consensus = useConsensusStatic();

  const activity = useQuery({
    queryKey: ['guru-activity'],
    queryFn: async () => {
      const r = await fetch('/guru-activity.json');
      return r.ok ? r.json() : null;
    },
    staleTime: Infinity,
  });

  const quarters = activity.data?.quarters || [];
  const names = activity.data?.names || {};
  const newest = quarters[0];

  // The quarter lives in the URL so a view can be linked and shared.
  const [sp, setSp] = useSearchParams();
  const urlQuarter = sp.get('q');
  const quarter = quarters.includes(urlQuarter) ? urlQuarter : newest;
  const setQuarter = (q) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!q || q === newest) next.delete('q');
        else next.set('q', q);
        return next;
      },
      { replace: true }
    );

  const [side, setSide] = useState('buys');
  const [kind, setKind] = useState('all');
  const [sector, setSector] = useState('');
  const [cap, setCap] = useState('');
  const [strong, setStrong] = useState(false);
  const [byPct, setByPct] = useState(false);
  const [sort, setSort] = useState({ key: 'nv', dir: 'desc' });
  const [showAll, setShowAll] = useState(false);

  // Only the newest quarter ships in the index; the rest are their own files.
  const older = useQuery({
    queryKey: ['guru-activity', quarter],
    queryFn: async () => {
      const r = await fetch(`/guru-activity-${quarter}.json`);
      return r.ok ? r.json() : null;
    },
    enabled: Boolean(quarter) && quarter !== newest,
    staleTime: Infinity,
  });

  const all = useMemo(
    () => (quarter === newest ? activity.data?.rows?.[quarter] : older.data?.rows) || [],
    [activity.data, older.data, quarter, newest]
  );
  const loading = activity.isLoading || (quarter !== newest && older.isLoading);

  // Only offer the columns and filters this dataset can actually fill: the
  // company profile is optional in the pipeline (see build-guru-activity.mjs).
  const cols = useMemo(
    () => ({
      sector: all.some((r) => r.sec),
      cap: all.some((r) => r.mc),
      kind: all.some((r) => r.etf),
    }),
    [all]
  );
  const sectors = useMemo(
    () => [...new Set(all.map((r) => r.sec).filter(Boolean))].sort(),
    [all]
  );

  useEffect(() => setShowAll(false), [quarter, side, kind, sector, cap, strong]);

  const rows = useMemo(() => {
    const KEY = {
      t: (r) => r.t,
      pct: (r) => (isFresh(r) ? Infinity : pctChange(r) ?? -Infinity),
      g: (r) => r.g,
      c: (r) => r.b - r.s,
      bs: (r) => (side === 'buys' ? r.bs : r.ss),
      nv: (r) => (byPct ? (isFresh(r) ? Infinity : pctChange(r) ?? -Infinity) : Math.abs(r.nv)),
    };
    const key = KEY[sort.key] || KEY.nv;
    const mul = sort.dir === 'desc' ? -1 : 1;
    return all
      .filter((r) => (side === 'buys' ? r.nv > 0 : r.nv < 0))
      .filter((r) => kind === 'all' || (kind === 'etf' ? r.etf : !r.etf))
      .filter((r) => !sector || r.sec === sector)
      .filter((r) => !cap || capBucket(r.mc) === cap)
      // "strong" means the group moved together: several buyers, nobody leaving
      .filter((r) => !strong || (side === 'buys' ? r.b >= 3 && r.s === 0 : r.s >= 3 && r.b === 0))
      .slice()
      .sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x === y) return 0;
        return (x < y ? -1 : 1) * mul;
      });
  }, [all, side, kind, sector, cap, strong, sort, byPct]);

  const onSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '');

  // free tier sees the head of the table, Pro the whole thing
  const visible = isPro ? (showAll ? rows : rows.slice(0, 50)) : rows.slice(0, 10);
  const filtered = Boolean(kind !== 'all' || sector || cap || strong);
  const trail = useMemo(() => {
    const i = quarters.indexOf(quarter);
    return quarters.slice(i, i + 4).slice().reverse();
  }, [quarters, quarter]);

  const data = consensus.data || {};
  const { managers = [], mostHeld = [], newPositions = [] } = data;
  const qLabel = quarter ? quarterLabel(quarter) : '';

  const answer = useMemo(() => {
    if (!all.length) return null;
    const buys = all.filter((r) => r.nv > 0).sort((a, b) => b.nv - a.nv);
    const sells = all.filter((r) => r.nv < 0).sort((a, b) => a.nv - b.nv);
    const top = buys[0];
    const bottom = sells[0];
    if (!top || !bottom) return null;
    return lang === 'tr'
      ? `${qLabel} çeyreğinde takip edilen ${managers.length || ''} usta yatırımcı en çok ${top.t} aldı (${fmtMoney(top.nv)} net, ${top.b} fon alıcı) ve en çok ${bottom.t} sattı (${fmtMoney(Math.abs(bottom.nv))} net, ${bottom.s} fon satıcı). Tabloda ${all.length} hisse, SEC 13F bildirimlerinden çeyrek bazında hesaplandı.`
      : `In ${qLabel} the tracked superinvestors bought ${top.t} most (${fmtMoney(top.nv)} net across ${top.b} funds) and sold ${bottom.t} most (${fmtMoney(Math.abs(bottom.nv))} net across ${bottom.s} funds). The table covers ${all.length} holdings, computed quarter over quarter from SEC 13F filings.`;
  }, [all, qLabel, managers, lang]);

  const faq = useMemo(() => {
    if (!all.length) return [];
    return lang === 'tr'
      ? [
          ['Net aktivite nasıl hesaplanıyor?', 'Takip edilen ustaların bir hissedeki toplam adedi, bir önceki çeyreğe göre ne kadar değiştiyse o fark çeyrek sonu fiyatıyla çarpılır. Artı ise net alım, eksi ise net satım.'],
          ['"% Değişim" neyi gösterir?', 'Ustaların o hissedeki toplam adedinin çeyrek içinde yüzde kaç arttığını veya azaldığını. Şirketin toplam hisse sayısına oranı değil, ustaların kendi pozisyonundaki değişim.'],
          ['Konsensüs etiketi ne demek?', 'Alıcı sayısı satıcının en az iki katıysa "Topluyor", satıcı sayısı alıcının en az iki katıysa "Dağıtıyor", aksi halde "Nötr".'],
          ['Veri ne kadar güncel?', '13F bildirimleri çeyrek bitiminden en geç 45 gün sonra açıklanır, yani en yeni çeyrek bile geçmişe dönüktür ve kısa vadeli alım satımı göstermez.'],
        ]
      : [
          ['How is net activity calculated?', "The change in the tracked superinvestors' combined share count for a stock versus the previous quarter, valued at the quarter-end price. Positive is net buying, negative is net selling."],
          ['What does "% change" mean?', "How much the gurus' combined position in that stock grew or shrank during the quarter. It is a change in their own holding, not a share of the company."],
          ['What does the consensus label mean?', 'Accumulating when buyers are at least twice the sellers, Distributing when sellers are at least twice the buyers, Neutral otherwise.'],
          ['How current is this?', '13F filings are disclosed up to 45 days after quarter end, so even the newest quarter is backward-looking and does not show short-term trading.'],
        ];
  }, [all, lang]);

  useSeo(
    useMemo(
      () => ({
        title:
          lang === 'tr'
            ? `Usta Yatırımcılar Ne Aldı, Ne Sattı — ${qLabel} | 13F Radar`
            : `What Superinvestors Bought and Sold — ${qLabel} | 13F Radar`,
        description: answer ? answer.slice(0, 155) : undefined,
        answer,
        path: '/report',
        dateModified: (activity.data?.updatedAt || '').slice(0, 10) || null,
        jsonLd: all.length
          ? [
              article({
                headline: lang === 'tr' ? 'Usta Yatırımcı Çeyrek Aktivitesi' : 'Superinvestor Quarterly Activity',
                description: answer,
                lang,
                path: '/report',
                datePublished: quarter,
                dateModified: (activity.data?.updatedAt || '').slice(0, 10) || quarter,
              }),
              itemList({
                name: lang === 'tr' ? `${qLabel} en çok alınanlar` : `${qLabel} most bought`,
                lang,
                items: all
                  .filter((r) => r.nv > 0)
                  .sort((a, b) => b.nv - a.nv)
                  .slice(0, 25)
                  .map((r) => ({ name: `${r.t} — ${names[r.t] || r.t} — ${fmtMoney(r.nv)}`, path: `/stock/${r.t}` })),
              }),
              ...(faq.length ? [faqJsonLd(faq)] : []),
              breadcrumbs(lang, [[t('report.title'), '/report']]),
            ]
          : [],
      }),
      [lang, qLabel, answer, all, faq, quarter, activity.data, names, t]
    )
  );

  const managerRows = useMemo(() => {
    const byManager = new Map();
    for (const p of newPositions) {
      const cur = byManager.get(p.cik) || { name: p.manager, cik: p.cik, buys: [] };
      cur.buys.push(p);
      byManager.set(p.cik, cur);
    }
    return [...byManager.values()].sort((a, b) => b.buys.length - a.buys.length);
  }, [newPositions]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>
            <Ico icon={Newspaper} size={22} /> {t('report.title')}
          </h1>
          <div className="sub">
            <b>{qLabel}</b> {t('report.subtitle')} · {managers.length} {t('report.funds')}
          </div>
        </div>
      </div>

      <AnswerBox text={answer} />

      {/* ---- buys / sells ------------------------------------------------ */}
      <div className="tabs">
        {SIDES.map((s) => (
          <button key={s} className={`tab${side === s ? ' active' : ''}`} onClick={() => setSide(s)}>
            {t(`report.side.${s}`)}
          </button>
        ))}
      </div>

      {/* ---- filters ------------------------------------------------------ */}
      <div className="card ins-toolbar">
        <div className="row" style={{ gap: 10 }}>
          <FilterSelect
            label={t('report.period')}
            value={quarter === newest ? '' : quarter}
            onChange={(v) => setQuarter(v || newest)}
            options={quarters.map((q) => ({ v: q === newest ? '' : q, label: quarterLabel(q) }))}
          />
          {cols.kind && (
            <div className="seg">
              {KINDS.map((k) => (
                <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {t(`report.kind.${k}`)}
                </button>
              ))}
            </div>
          )}
          {cols.sector && (
            <FilterSelect
              label={t('ins.sector')}
              value={sector}
              onChange={setSector}
              options={[{ v: '', label: t('report.allSectors') }, ...sectors.map((s) => ({ v: s, label: s }))]}
            />
          )}
          {cols.cap && (
            <FilterSelect
              label={t('screen.size')}
              value={cap}
              onChange={setCap}
              options={[{ v: '', label: t('report.allCaps') }, ...CAPS.map((c) => ({ v: c.v, label: t(`size.${c.v}`) }))]}
            />
          )}
          <button
            className={`chip${strong ? ' fsel-active' : ''}`}
            onClick={() => setStrong((v) => !v)}
            aria-pressed={strong}
          >
            <Ico icon={Flame} size={14} /> {t(`report.strong.${side}`)}
          </button>
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {fmtNum(rows.length)} {t('report.results')}
          </span>
          {filtered && (
            <button
              className="btn ghost sm"
              onClick={() => { setKind('all'); setSector(''); setCap(''); setStrong(false); }}
            >
              {t('screen.reset')}
            </button>
          )}
        </div>
      </div>

      {/* ---- table -------------------------------------------------------- */}
      <div className="card mt16">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <b>{t(`report.side.${side}`)}</b>
          <div className="seg">
            {[false, true].map((p) => (
              <button key={String(p)} className={byPct === p ? 'on' : ''} onClick={() => { setByPct(p); setSort({ key: 'nv', dir: 'desc' }); }}>
                {p ? t('report.byPct') : t('report.byValue')}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          <table className="data ins-table">
            <thead>
              <tr>
                <th className="l sortable" onClick={() => onSort('t')}>{t('table.symbol')}{arrow('t')}</th>
                <th className="l">{t('table.company')}</th>
                <th className="sortable" onClick={() => onSort('pct')}>
                  {t('report.th.pct')}<InfoTip tip="tips.reportPct" />{arrow('pct')}
                </th>
                <th className="sortable" onClick={() => onSort('g')}>{t('report.th.gurus')}{arrow('g')}</th>
                <th className="sortable" onClick={() => onSort('c')}>
                  {t('report.th.consensus')}<InfoTip tip="tips.reportConsensus" />{arrow('c')}
                </th>
                <th className="sortable" onClick={() => onSort('bs')}>{t(`report.th.shares.${side}`)}{arrow('bs')}</th>
                <th className="sortable" onClick={() => onSort('nv')}>
                  {t('report.th.net')}<InfoTip tip="tips.reportNet" />{arrow('nv')}
                </th>
                <th className="l">{t('report.th.activity')}</th>
              </tr>
            </thead>
            <tbody>
              {!visible.length && (
                <tr>
                  <td className="l muted" colSpan={8}>
                    {loading ? t('common.loading') : t('ins.noResults')}
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const pct = pctChange(r);
                const con = consensusOf(r);
                return (
                  <tr key={r.t}>
                    <td className="l"><Sym t={r.t} /></td>
                    <td className="l">
                      <div className="ins-co">{names[r.t] || r.t}</div>
                      {r.sec && <div className="muted small">{r.sec}</div>}
                    </td>
                    <td className={`num ${isFresh(r) ? 'delta-pos' : deltaClass(pct)}`}>
                      {isFresh(r) ? t('penny.newPosition') : pct != null ? fmtPct(pct, { digits: 2 }) : '—'}
                    </td>
                    <td className="num">
                      <b>{fmtNum(r.g)}</b>
                      {r.ng > 0 && <div className="small delta-pos">{r.ng} {t('report.new')}</div>}
                    </td>
                    <td className="num">
                      <span className={`badge ${con === 'accumulating' ? 'pos' : con === 'distributing' ? 'neg' : 'plain'}`}>
                        {t(`report.consensus.${con}`)}
                      </span>
                    </td>
                    <td className="num">{fmtNum(side === 'buys' ? r.bs : r.ss)}</td>
                    <td className={`num ${r.nv >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                      <b>{fmtMoney(Math.abs(r.nv))}</b>
                    </td>
                    <td className="l">
                      <GuruActivityBars
                        series={r.sp}
                        quarters={trail}
                        label={`${r.t} ${t('report.th.activity')}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!isPro && rows.length > 10 && (
          <div className="mt16">
            <p className="muted small" style={{ marginBottom: 8 }}>
              {t('report.locked').replace('{n}', String(rows.length - 10))}
            </p>
            <Paywall compact />
          </div>
        )}
        {isPro && !showAll && rows.length > 50 && (
          <button className="btn ghost mt16" onClick={() => setShowAll(true)}>
            {t('common.all')} ({fmtNum(rows.length)})
          </button>
        )}
      </div>

      {/* ---- quarter recap ------------------------------------------------ */}
      <div className="card mt16">
        <h3><Ico icon={Crown} /> {t('report.kings')}</h3>
        <p className="muted small" style={{ marginBottom: 8 }}>{t('report.kingsNote')}</p>
        <div className="row" style={{ gap: 8 }}>
          {mostHeld.slice(0, 8).map((r) => (
            <span key={r.cusip} className="chip" style={{ cursor: 'default' }}>
              {r.ticker ? <Sym t={r.ticker} /> : <b>{r.issuer}</b>}
              <span className="muted small"> · {r.holderCount} {t('report.funds')}</span>
            </span>
          ))}
        </div>
      </div>

      {isPro && managerRows.length > 0 && (
        <div className="card mt16">
          <h3><Ico icon={Landmark} /> {t('report.byManager')}</h3>
          {managerRows.map((m) => (
            <div className="pos-row" key={m.cik} style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <Link to={managerPath(m.cik)} style={{ fontWeight: 700 }}>{m.name}</Link>{' '}
                <span className="muted">
                  {t('report.enteredA')} {m.buys.length} {t('report.enteredB')}
                </span>
                <div className="small" style={{ marginTop: 2 }}>
                  {m.buys.slice(0, 5).map((p, i) => (
                    <span key={p.cusip}>
                      {i > 0 && ' · '}
                      {p.ticker ? <Sym t={p.ticker} /> : <b>{p.issuer}</b>}
                      <span className="muted"> ({fmtPct(p.weight, { sign: false })})</span>
                    </span>
                  ))}
                  {m.buys.length > 5 && <span className="muted"> +{m.buys.length - 5}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Faq items={faq} />
      <p className="muted small mt16">{t('report.note')}</p>
      <Disclaimer />
    </div>
  );
}
