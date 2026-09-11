import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtNum, fmtPct, deltaClass } from '../lib/format.js';
import { breadcrumbs, faqJsonLd } from '../lib/seoTemplates.js';
import { article, itemList } from '../lib/jsonld.js';
import { reportAnswer } from '../lib/reportText.js';
import AnswerBox from '../components/AnswerBox.jsx';
import Faq, { Disclaimer } from '../components/Faq.jsx';
import { managerPath } from '../lib/paths.js';

const Sym = ({ r }) => (r.ticker ? <Link to={`/stock/${r.ticker}${r.cusip ? `?cusip=${r.cusip}` : ''}`} style={{ fontWeight: 700 }}>{r.ticker}</Link> : <b>{r.issuer}</b>);

function Table({ title, rows, cols, empty }) {
  return (
    <div className="card mt16">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table className="data">
          <thead><tr>{cols.map((c) => <th key={c.h} className={c.l ? 'l' : ''}>{c.h}</th>)}</tr></thead>
          <tbody>
            {!rows?.length && <tr><td className="l muted" colSpan={cols.length}>{empty}</td></tr>}
            {(rows || []).map((r, i) => (
              <tr key={i}>{cols.map((c) => <td key={c.h} className={c.l ? 'l' : `num ${c.cls ? c.cls(r) : ''}`}>{c.v(r, i)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// /reports and /reports/:id — generated quarterly superinvestor reports.
export default function ReportPage() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const index = useQuery({ queryKey: ['reports'], queryFn: api.reports, staleTime: Infinity, enabled: !id });
  const rep = useQuery({ queryKey: ['report', id], queryFn: () => api.report(id), staleTime: Infinity, enabled: !!id, retry: 0 });
  const r = rep.data;
  const answer = r ? reportAnswer(r, lang) : null;
  const title = r ? (lang === 'tr' ? `${r.year} Q${r.quarter} Usta Yatırımcı Raporu` : `Q${r.quarter} ${r.year} Superinvestor Report`) : lang === 'tr' ? 'Çeyrek Raporları' : 'Quarterly Reports';
  const faq = r
    ? lang === 'tr'
      ? [[`${r.year} Q${r.quarter} çeyreğinde usta yatırımcılar en çok hangi hisseyi aldı?`, answer], ['Bu rapor nasıl üretiliyor?', `Rapor, takip edilen ${r.coverage.tracked} fonun SEC 13F-HR bildirimlerinden otomatik derlenir: net alım/satım tutarları, alıcı/satıcı sayıları, yeni konsensüs pozisyonları, en büyük çıkışlar ve pay değişimi en yüksek hamleler. Veri üretim tarihi: ${r.generatedAt.slice(0, 10)}.`]]
      : [[`What did superinvestors buy most in Q${r.quarter} ${r.year}?`, answer], ['How is this report produced?', `It is assembled automatically from the SEC 13F-HR filings of the ${r.coverage.tracked} tracked funds: net dollar buys and sells, buyer/seller counts, new consensus positions, biggest exits and the largest percentage moves. Generated ${r.generatedAt.slice(0, 10)}.`]]
    : [];
  useSeo(
    useMemo(
      () => ({
        title: `${title} | 13F Radar`,
        description: answer ? answer.slice(0, 155) : lang === 'tr' ? 'Usta yatırımcıların çeyreklik 13F raporları: en çok alınan ve satılanlar, yeni konsensüs pozisyonları, en büyük çıkışlar.' : 'Quarterly superinvestor 13F reports: most bought and sold, new consensus positions, biggest exits.',
        answer,
        path: id ? `/reports/${id}` : '/reports',
        image: id ? `/api/og?type=report&id=${id}&chart=buys` : undefined,
        dateModified: r?.generatedAt?.slice(0, 10) || null,
        jsonLd: r
          ? [
              article({ headline: title, description: answer, lang, path: `/reports/${id}`, datePublished: r.generatedAt.slice(0, 10), dateModified: r.dataUpdatedAt?.slice(0, 10) || r.generatedAt.slice(0, 10), image: `/api/og?type=report&id=${id}&chart=buys` }),
              itemList({ name: lang === 'tr' ? 'En çok alınanlar' : 'Top net buys', lang, items: r.topBuysByValue.filter((x) => x.ticker).map((x) => ({ name: `${x.ticker} — ${x.issuer}`, path: `/stock/${x.ticker}` })) }),
              faqJsonLd(faq),
              breadcrumbs(lang, [[lang === 'tr' ? 'Raporlar' : 'Reports', '/reports'], [title, `/reports/${id}`]]),
            ]
          : [breadcrumbs(lang, [[lang === 'tr' ? 'Raporlar' : 'Reports', '/reports']])],
      }),
      [title, answer, lang, id, r, faq]
    )
  );

  if (!id) {
    const ids = index.data?.reports || [];
    return (
      <div>
        <div className="page-head"><div><h1>📰 {title}</h1><div className="sub">{t('rep.indexSub')}</div></div></div>
        <div className="grid grid-3">
          {ids.map((x) => (
            <Link key={x} to={`/reports/${x}`} className="card feature-card"><h3>{x.toUpperCase()}</h3><p className="muted small">{t('rep.open')}</p></Link>
          ))}
          {!ids.length && <div className="card muted">{t('common.na')}</div>}
        </div>
      </div>
    );
  }
  if (rep.isLoading) return <div className="loading"><div className="spinner" />{t('common.loading')}</div>;
  if (rep.error || !r) return <div className="error-box">{t('rep.notFound')}</div>;

  const money = (v) => fmtMoney(v);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>📰 {title}</h1>
          <div className="sub">{t('rep.sub').replace('{n}', r.coverage.onQuarter).replace('{m}', r.coverage.tracked).replace('{d}', r.quarterEnd)} · {t('rep.generated')} {r.generatedAt.slice(0, 10)}</div>
        </div>
        <div className="row">
          <a className="btn ghost" href={`/api/report-id/${id}?format=md`}>⬇ Markdown</a>
          <a className="btn ghost" href={`/api/og?type=report&id=${id}&chart=buys`} target="_blank" rel="noreferrer">🖼 {t('rep.chartPack')}</a>
        </div>
      </div>
      <AnswerBox text={answer} />

      <div className="grid grid-3">
        {['buys', 'sells', 'moves'].map((c) => (
          <a key={c} href={`/api/og?type=report&id=${id}&chart=${c}`} target="_blank" rel="noreferrer" className="card" style={{ padding: 8 }}>
            <img src={`/api/og?type=report&id=${id}&chart=${c}`} alt={`${title} — ${c}`} width="1200" height="630" style={{ width: '100%', height: 'auto', borderRadius: 8 }} loading="lazy" />
          </a>
        ))}
      </div>

      <div className="grid grid-2 mt16">
        <Table title={t('rep.buysValue')} rows={r.topBuysByValue} empty={t('common.na')} cols={[{ h: t('table.symbol'), l: true, v: (x) => <Sym r={x} /> }, { h: t('table.company'), l: true, v: (x) => x.issuer }, { h: t('landing.act.netBuy'), v: (x) => money(x.netValue), cls: () => 'delta-pos' }, { h: t('rep.buyers'), v: (x) => x.buyers }, { h: t('landing.act.ytd'), v: (x) => (x.retYtd != null ? fmtPct(x.retYtd) : '—'), cls: (x) => deltaClass(x.retYtd) }]} />
        <Table title={t('rep.sellsValue')} rows={r.topSellsByValue} empty={t('common.na')} cols={[{ h: t('table.symbol'), l: true, v: (x) => <Sym r={x} /> }, { h: t('table.company'), l: true, v: (x) => x.issuer }, { h: t('landing.act.netSell'), v: (x) => money(Math.abs(x.netValue)), cls: () => 'delta-neg' }, { h: t('rep.sellers'), v: (x) => x.sellers }, { h: t('landing.act.ytd'), v: (x) => (x.retYtd != null ? fmtPct(x.retYtd) : '—'), cls: (x) => deltaClass(x.retYtd) }]} />
        <Table title={t('rep.buysCount')} rows={r.topBuysByCount} empty={t('common.na')} cols={[{ h: t('table.symbol'), l: true, v: (x) => <Sym r={x} /> }, { h: t('rep.buyers'), v: (x) => x.buyers }, { h: t('landing.act.netBuy'), v: (x) => money(x.netValue) }]} />
        <Table title={t('rep.sellsCount')} rows={r.topSellsByCount} empty={t('common.na')} cols={[{ h: t('table.symbol'), l: true, v: (x) => <Sym r={x} /> }, { h: t('rep.sellers'), v: (x) => x.sellers }, { h: t('landing.act.netSell'), v: (x) => money(Math.abs(x.netValue)) }]} />
      </div>

      <Table title={t('rep.newConsensus')} rows={r.newConsensus || []} empty={r.newConsensus ? t('common.na') : t('rep.needsHistory')} cols={[{ h: t('table.symbol'), l: true, v: (x) => <Sym r={x} /> }, { h: t('table.company'), l: true, v: (x) => x.issuer }, { h: t('rep.holdersNow'), v: (x) => x.holderCount }, { h: t('rep.holdersPrev'), v: (x) => x.prevHolderCount }]} />
      <Table title={t('rep.exits')} rows={r.biggestExits} empty={t('common.na')} cols={[{ h: t('screen.manager'), l: true, v: (x) => <Link to={managerPath(x.cik)}>{x.manager}</Link> }, { h: t('table.symbol'), l: true, v: (x) => <Sym r={x} /> }, { h: t('rep.valueSold'), v: (x) => money(x.value), cls: () => 'delta-neg' }]} />
      <div className="card mt16"><h3>{t('rep.sector')}</h3><p className="muted small">{t('rep.sectorTodo')}</p></div>
      <Table title={t('rep.notable')} rows={r.notableMoves} empty={t('common.na')} cols={[{ h: t('screen.manager'), l: true, v: (x) => <Link to={managerPath(x.cik)}>{x.manager}</Link> }, { h: t('pair.activity'), l: true, v: (x) => t(`pair.act.${x.kind}`) }, { h: t('table.symbol'), l: true, v: (x) => <Sym r={x} /> }, { h: t('pair.deltaPct'), v: (x) => fmtPct(x.change), cls: (x) => deltaClass(x.change) }, { h: t('table.value'), v: (x) => money(x.value) }, { h: t('table.weight'), v: (x) => fmtPct(x.weight, { sign: false, digits: 2 }) }]} />
      <Table title={t('rep.newPositions')} rows={r.newPositions} empty={t('common.na')} cols={[{ h: t('screen.manager'), l: true, v: (x) => <Link to={managerPath(x.cik)}>{x.manager}</Link> }, { h: t('table.symbol'), l: true, v: (x) => <Sym r={x} /> }, { h: t('table.weight'), v: (x) => fmtPct(x.weight, { sign: false, digits: 2 }) }, { h: t('table.value'), v: (x) => money(x.value) }]} />
      <p className="muted small mt16">{t('rep.managers')}: {r.managers.map((m, i) => <span key={m.cik}>{i > 0 && ', '}<Link to={managerPath(m.cik)}>{m.name}</Link></span>)} · <Link to="/calendar">{t('cal.title')}</Link></p>
      <Faq items={faq} />
      <Disclaimer />
    </div>
  );
}
