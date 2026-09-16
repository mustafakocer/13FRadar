import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { useGuruStocks, useGuruOptions } from '../hooks/useGuruStocks.js';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtNum, fmtPct, deltaClass, quarterLabel } from '../lib/format.js';
import { quarterText, rankingJsonLd } from '../lib/seoTemplates.js';
import Faq, { Disclaimer } from '../components/Faq.jsx';
import AnswerBox from '../components/AnswerBox.jsx';
import { rankingAnswer, truncate155 } from '../lib/answerBox.js';
import { managerPath } from '../lib/paths.js';
import FilterSelect from '../components/FilterSelect.jsx';
import Ico from '../components/Ico.jsx';
import { Trophy } from 'lucide-react';

// Indexable ranking pages over the securities the curated funds hold. The
// per-security table (/api/guru-stocks) covers every name they own; the
// public consensus file — thirty rows — is the fallback for a checkout where
// the daily Action has not written that table yet.
const KINDS = {
  'most-bought': { key: 'rank.mostBought', sort: (a, b) => b.netValue - a.netValue, filter: (r) => r.netValue > 0, value: (r) => fmtMoney(r.netValue), pct: (r) => (r.totalValue ? (r.netValue / r.totalValue) * 100 : null), count: (r) => r.buyers, cls: 'delta-pos' },
  'most-sold': { key: 'rank.mostSold', sort: (a, b) => a.netValue - b.netValue, filter: (r) => r.netValue < 0, value: (r) => fmtMoney(Math.abs(r.netValue)), pct: (r) => (r.totalValue ? (r.netValue / r.totalValue) * 100 : null), count: (r) => r.sellers, cls: 'delta-neg' },
  consensus: { key: 'rank.consensus', sort: (a, b) => b.holderCount - a.holderCount || b.totalValue - a.totalValue, filter: () => true, value: (r) => fmtMoney(r.totalValue), pct: (r) => r.avgWeight, count: (r) => r.holderCount, cls: '' },
  conviction: { key: 'rank.conviction', sort: (a, b) => b.maxWeight - a.maxWeight || b.avgWeight - a.avgWeight, filter: (r) => r.holderCount >= 2, value: (r) => fmtMoney(r.totalValue), pct: (r) => r.maxWeight ?? r.avgWeight, count: (r) => r.holderCount, cls: '' },
  options: { key: 'rank.options', sort: (a, b) => b.totalValue - a.totalValue, filter: () => true, value: (r) => fmtMoney(r.totalValue), pct: () => null, count: (r) => r.holderCount, cls: '' },
};

// Ranking by share of the position rather than dollars: a $20M new stake in a
// small name says more about conviction than $200M added to a mega cap.
const byPercent = {
  'most-bought': (a, b) => (b.netValue / (b.totalValue || 1)) - (a.netValue / (a.totalValue || 1)),
  'most-sold': (a, b) => (a.netValue / (a.totalValue || 1)) - (b.netValue / (b.totalValue || 1)),
};

const CAPS = ['mega', 'large', 'mid', 'small', 'micro'];

export default function Rankings() {
  const { kind: kindParam } = useParams();
  const kind = KINDS[kindParam] ? kindParam : 'consensus';
  const def = KINDS[kind];
  const { t, lang } = useI18n();

  const [sector, setSector] = useState('');
  const [cap, setCap] = useState('');
  const [strongBuy, setStrongBuy] = useState(false);
  const [mode, setMode] = useState('value'); // value | percent

  const isOptions = kind === 'options';
  const table = useGuruStocks({
    limit: 300,
    sector,
    cap,
    strongBuy: strongBuy && kind === 'most-bought',
  });
  const optionTable = useGuruOptions();
  const { data, isLoading } = useConsensusStatic();
  const returns = useStaticReturns();

  // The full table when the build has produced one, the public thirty when not.
  const source = isOptions
    ? optionTable.options
    : table.ready
      ? table.stocks
      : data?.mostHeld || [];

  const rows = useMemo(() => {
    const sorted = [...source].filter(def.filter);
    const cmp = mode === 'percent' && byPercent[kind] ? byPercent[kind] : def.sort;
    return sorted.sort(cmp);
  }, [source, def, kind, mode]);

  const latest =
    table.reportDate || (data?.managers || []).reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');
  const managerCount = table.managers || data?.managers?.length;
  const qt = quarterText(latest, lang);
  const title = t(def.key);
  const answer = useMemo(
    () => rankingAnswer({ kind, reportDate: latest, first: rows[0], managers: managerCount }, lang),
    [kind, latest, rows, managerCount, lang]
  );
  const ld = useMemo(
    () => rankingJsonLd({ lang, kind, title, path: `/rankings/${kind}`, answer, rows, reportDate: latest, updatedAt: data?.updatedAt, managers: managerCount }),
    [lang, kind, title, answer, rows, latest, data, managerCount]
  );
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? `${title} — Usta Yatırımcılar ${qt} | Fundocap` : `${title} — Superinvestors ${qt} | Fundocap`,
        description: answer
          ? truncate155(answer)
          : lang === 'tr'
            ? `${managerCount || ''} efsane fonun ${qt} 13F bildirimlerine göre ${title.toLowerCase()} listesi.`
            : `${title} across ${managerCount || ''} legendary funds, from ${qt} 13F filings.`,
        answer,
        path: `/rankings/${kind}`,
        dateModified: (data?.updatedAt || '').slice(0, 10) || null,
        jsonLd: ld.jsonLd,
      }),
      [lang, kind, title, qt, data, answer, ld, managerCount]
    )
  );

  const loading = isOptions ? optionTable.isLoading : table.isLoading || isLoading;
  const OPT = (values, prefix) => [
    { v: '', label: t('screen.all') },
    ...values.map((v) => ({ v, label: prefix ? t(`${prefix}.${v}`) : v })),
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1><Ico icon={Trophy} size={22} /> {title}</h1>
          <div className="sub">{lang === 'tr' ? `Usta yatırımcı seti · ${latest ? quarterLabel(latest) : ''}` : `Superinvestor set · ${latest ? quarterLabel(latest) : ''}`}</div>
        </div>
      </div>
      <AnswerBox text={answer} />
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {Object.keys(KINDS).map((k) => (
          <Link key={k} to={`/rankings/${k}`} className={`chip${k === kind ? ' fsel-active' : ''}`}>{t(KINDS[k].key)}</Link>
        ))}
      </div>

      {/* Filters only appear once the build has classified the table — offering
          a sector picker over rows with no sector would quietly hide names. */}
      {!isOptions && table.ready && (
        <div className="row" style={{ gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {table.sectors.length > 0 && (
            <FilterSelect label={t('screen.sector')} value={sector} onChange={setSector} options={OPT(table.sectors)} />
          )}
          <FilterSelect label={t('screen.size')} value={cap} onChange={setCap} options={OPT(CAPS, 'size')} />
          {(kind === 'most-bought' || kind === 'most-sold') && (
            <button className={`chip${mode === 'percent' ? ' fsel-active' : ''}`} onClick={() => setMode(mode === 'percent' ? 'value' : 'percent')}>
              {mode === 'percent' ? t('rank.byPercent') : t('rank.byValue')}
            </button>
          )}
          {kind === 'most-bought' && (
            <button className={`chip${strongBuy ? ' fsel-active' : ''}`} onClick={() => setStrongBuy(!strongBuy)}>
              {t('rank.strongBuy')}
            </button>
          )}
          <span className="small muted" style={{ alignSelf: 'center' }}>
            {fmtNum(rows.length)} / {fmtNum(table.universe)}
          </span>
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">{t('table.rank')}</th>
                <th className="l">{t('table.symbol')}</th>
                <th className="l">{t('table.company')}</th>
                {isOptions && <th className="l">{t('rank.side')}</th>}
                <th>{kind === 'most-bought' ? t('landing.act.netBuy') : kind === 'most-sold' ? t('landing.act.netSell') : t('consensus.totalValue')}</th>
                {!isOptions && <th>{kind === 'consensus' ? t('consensus.avgWeight') : kind === 'conviction' ? t('rank.topWeight') : '%'}</th>}
                <th>{t('consensus.funds')}</th>
                {!isOptions && <th>{t('landing.act.ytd')}</th>}
                <th className="l">{t('consensus.heldBy')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ret = r.ticker ? (returns.data?.[r.ticker]?.retYtd ?? null) : null;
                const pct = def.pct(r);
                return (
                  <tr key={`${r.cusip}-${r.putCall || ''}`}>
                    <td className="l muted">{i + 1}</td>
                    <td className="l">{r.ticker ? <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }}>{r.ticker}</Link> : <span className="muted small">{r.cusip}</span>}</td>
                    <td className="l">{r.issuer}</td>
                    {isOptions && (
                      <td className="l">
                        <span className={`badge ${r.putCall === 'Put' ? 'neg' : 'pos'}`}>{r.putCall}</span>
                      </td>
                    )}
                    <td className={`num ${def.cls}`}>{def.value(r)}</td>
                    {!isOptions && (
                      <td className="num">{pct != null ? fmtPct(pct, { sign: kind === 'most-bought' || kind === 'most-sold' }) : '—'}</td>
                    )}
                    <td className="num">{def.count(r)}</td>
                    {!isOptions && <td className={`num ${deltaClass(ret)}`}>{ret != null ? fmtPct(ret) : '—'}</td>}
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
        <p className="muted small mt8">{t('landing.act.note')} · <Link to="/calendar">{t('cal.title')}</Link> · <Link to="/reports">{t('rep.indexSub')}</Link></p>
        <Disclaimer />
      </div>
      <Faq items={ld.faq} />
    </div>
  );
}
