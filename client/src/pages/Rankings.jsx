import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtPct, deltaClass, quarterLabel } from '../lib/format.js';
import { breadcrumbs, quarterText } from '../lib/seoTemplates.js';
import { Disclaimer } from '../components/Faq.jsx';
import AnswerBox from '../components/AnswerBox.jsx';
import { rankingAnswer, truncate155 } from '../lib/answerBox.js';
import { managerPath } from '../lib/paths.js';

// Indexable ranking pages computed from the public consensus file
// (30 most-held stocks of the superinvestor set, with buyer/seller counts
// and net dollar flows for the latest quarter).
const KINDS = {
  'most-bought': { key: 'rank.mostBought', sort: (a, b) => b.netValue - a.netValue, filter: (r) => r.netValue > 0, value: (r) => fmtMoney(r.netValue), pct: (r) => (r.totalValue ? (r.netValue / r.totalValue) * 100 : null), count: (r) => r.buyers, cls: 'delta-pos' },
  'most-sold': { key: 'rank.mostSold', sort: (a, b) => a.netValue - b.netValue, filter: (r) => r.netValue < 0, value: (r) => fmtMoney(Math.abs(r.netValue)), pct: (r) => (r.totalValue ? (r.netValue / r.totalValue) * 100 : null), count: (r) => r.sellers, cls: 'delta-neg' },
  consensus: { key: 'rank.consensus', sort: (a, b) => b.holderCount - a.holderCount || b.totalValue - a.totalValue, filter: () => true, value: (r) => fmtMoney(r.totalValue), pct: (r) => r.avgWeight, count: (r) => r.holderCount, cls: '' },
  conviction: { key: 'rank.conviction', sort: (a, b) => b.avgWeight - a.avgWeight, filter: (r) => r.holderCount >= 2, value: (r) => fmtMoney(r.totalValue), pct: (r) => r.avgWeight, count: (r) => r.holderCount, cls: '' },
};

export default function Rankings() {
  const { kind: kindParam } = useParams();
  const kind = KINDS[kindParam] ? kindParam : 'consensus';
  const def = KINDS[kind];
  const { t, lang } = useI18n();
  const { data, isLoading } = useConsensusStatic();
  const returns = useStaticReturns();
  const rows = useMemo(() => [...(data?.mostHeld || [])].filter(def.filter).sort(def.sort), [data, def]);
  const latest = (data?.managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');
  const qt = quarterText(latest, lang);
  const title = t(def.key);
  const answer = useMemo(() => rankingAnswer({ kind, reportDate: latest, first: rows[0], managers: data?.managers?.length }, lang), [kind, latest, rows, data, lang]);
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? `${title} — Usta Yatırımcılar ${qt} | 13F Radar` : `${title} — Superinvestors ${qt} | 13F Radar`,
        description: answer
          ? truncate155(answer)
          : lang === 'tr'
            ? `${data?.managers?.length || ''} efsane fonun ${qt} 13F bildirimlerine göre ${title.toLowerCase()} listesi.`
            : `${title} across ${data?.managers?.length || ''} legendary funds, from ${qt} 13F filings.`,
        answer,
        path: `/rankings/${kind}`,
        jsonLd: [breadcrumbs(lang, [[t('footer.rankings'), '/rankings/consensus'], [title, `/rankings/${kind}`]])],
      }),
      [lang, kind, title, qt, rows, data, t, answer]
    )
  );
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏆 {title}</h1>
          <div className="sub">{lang === 'tr' ? `Usta yatırımcı seti · ${latest ? quarterLabel(latest) : ''}` : `Superinvestor set · ${latest ? quarterLabel(latest) : ''}`}</div>
        </div>
      </div>
      <AnswerBox text={answer} />
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {Object.keys(KINDS).map((k) => (
          <Link key={k} to={`/rankings/${k}`} className={`chip${k === kind ? ' fsel-active' : ''}`}>{t(KINDS[k].key)}</Link>
        ))}
      </div>
      {isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">{t('table.rank')}</th>
                <th className="l">{t('table.symbol')}</th>
                <th className="l">{t('table.company')}</th>
                <th>{kind === 'most-bought' ? t('landing.act.netBuy') : kind === 'most-sold' ? t('landing.act.netSell') : t('consensus.totalValue')}</th>
                <th>{kind === 'consensus' || kind === 'conviction' ? t('consensus.avgWeight') : '%'}</th>
                <th>{t('consensus.funds')}</th>
                <th>{t('landing.act.ytd')}</th>
                <th className="l">{t('consensus.heldBy')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ret = r.ticker ? returns.data?.[r.ticker]?.retYtd : null;
                const pct = def.pct(r);
                return (
                  <tr key={r.cusip}>
                    <td className="l muted">{i + 1}</td>
                    <td className="l">{r.ticker ? <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }}>{r.ticker}</Link> : <span className="muted small">{r.cusip}</span>}</td>
                    <td className="l">{r.issuer}</td>
                    <td className={`num ${def.cls}`}>{def.value(r)}</td>
                    <td className="num">{pct != null ? fmtPct(pct, { sign: kind === 'most-bought' || kind === 'most-sold' }) : '—'}</td>
                    <td className="num">{def.count(r)}</td>
                    <td className={`num ${deltaClass(ret)}`}>{ret != null ? fmtPct(ret) : '—'}</td>
                    <td className="l small">
                      {(r.holders || []).slice(0, 3).map((h, j) => (
                        <span key={h.cik}>{j > 0 && ', '}<Link to={managerPath(h.cik, h.path)}>{h.name}</Link></span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small mt8">{t('landing.act.note')}</p>
        <Disclaimer />
      </div>
    </div>
  );
}
