import { useMemo } from 'react';
import { prettyName } from '../lib/label.js';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtNum, fmtPct, fmtPx, deltaClass, quarterLabel } from '../lib/format.js';
import { breadcrumbs, quarterText } from '../lib/seoTemplates.js';
import { timeHeldLabel } from '../lib/timeHeld.js';
import { Disclaimer } from '../components/Faq.jsx';

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

function Kpi({ label, value, sub, cls = '' }) {
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div className="small muted">{label}</div>
      <div className={cls} style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

// /guru/:slug/:ticker — every quarter's activity for one guru × security
// pair, from the precomputed history (public, indexable).
export default function GuruTicker() {
  const { slug, ticker } = useParams();
  const { t, lang } = useI18n();
  const slugQ = useQuery({ queryKey: ['slug', slug], queryFn: () => api.slug(slug), staleTime: Infinity, retry: 0 });
  const cik = slugQ.data?.cik || null;
  const tk = String(ticker || '').toUpperCase();
  const pair = useQuery({
    queryKey: ['guru-ticker', cik, tk],
    queryFn: () => api.guruTicker(cik, tk),
    enabled: !!cik,
    staleTime: 6 * 60 * 60 * 1000,
    retry: 0,
  });
  const d = pair.data;
  const cost = d?.cost || null;
  const name = slugQ.data?.name || '';
  const latest = d?.rows?.[d.rows.length - 1];
  useSeo(
    useMemo(() => {
      if (!d) return { title: `${name || slug} — ${tk} | Fundocap`, path: `/guru/${slug}/${tk}` };
      const held = latest?.shares > 0;
      const qt = quarterText(latest?.reportDate, lang);
      return {
        title: `${fill(t('pair.title'), { name, ticker: tk })} | Fundocap`,
        description:
          lang === 'tr'
            ? `${name} ${tk} (${d.issuer}) pozisyonunu ${d.rows.length} çeyrek boyunca nasıl değiştirdi: ${held ? `${qt} itibarıyla ${fmtNum(latest.shares)} adet, portföyün %${latest.weight.toFixed(2)}'i, ${timeHeldLabel(d.heldQuarters, lang, { dataFrom: d.dataFrom })} elde tutuluyor.` : `pozisyon ${qt} itibarıyla kapalı.`}`
            : `How ${name} traded ${tk} (${d.issuer}) over ${d.rows.length} quarters: ${held ? `${fmtNum(latest.shares)} shares as of ${qt}, ${latest.weight.toFixed(2)}% of the portfolio, held for ${timeHeldLabel(d.heldQuarters, lang, { dataFrom: d.dataFrom })}.` : `position closed as of ${qt}.`}`,
        path: `/guru/${slug}/${tk}`,
        type: 'article',
        jsonLd: [breadcrumbs(lang, [[lang === 'tr' ? 'Usta Yatırımcılar' : 'Superinvestors', '/gurus'], [name, `/guru/${slug}`], [tk, `/guru/${slug}/${tk}`]])],
      };
    }, [d, name, slug, tk, lang, t, latest])
  );

  if (slugQ.error) return <div className="error-box">{t('manager.unknownSlug')}</div>;
  if (!cik || pair.isLoading) return <div className="loading"><div className="spinner" />{t('common.loading')}</div>;
  if (pair.error) return <div className="error-box">{t('hist.none')}</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{fill(t('pair.title'), { name, ticker: tk })}</h1>
          <div className="sub">{fill(t('pair.sub'), { issuer: prettyName(d.issuer) })} · CUSIP {d.cusip}</div>
          <div className="head-badges">
            {d.heldQuarters > 0 ? (
              <span className="badge plain">{t('pair.heldSince')} · {timeHeldLabel(d.heldQuarters, lang, { dataFrom: d.dataFrom })}</span>
            ) : (
              <span className="badge neg">{t('pair.act.exit')}</span>
            )}
            <span className="badge plain">{t('pair.firstSeen')}: {quarterLabel(d.firstSeen)}</span>
            {d.splitAdjusted && <span className="badge type">split-adjusted</span>}
          </div>
        </div>
        <div className="row">
          <Link to={`/guru/${slug}`} className="btn ghost">← {t('pair.backGuru')}</Link>
          <Link to={`/stock/${tk}?cusip=${d.cusip}`} className="btn ghost">{t('pair.backStock')} →</Link>
        </div>
      </div>
      {/* what the guru probably paid, against today's price (costBasis.js) */}
      {cost && (cost.avgBuy != null || cost.unpriced) && (
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <Kpi
            label={t('pair.avgBuy')}
            value={cost.avgBuy != null ? fmtPx(cost.avgBuy) : '—'}
            sub={cost.unpriced ? t('pair.unpriced') : `${t('pair.since')}: ${quarterLabel(cost.since)}${cost.openedBeforeData ? ` (${t('pair.openedBeforeData')})` : ''}`}
          />
          <Kpi
            label={t('pair.current')}
            value={cost.current != null ? fmtPx(cost.current) : '—'}
            sub={cost.asOf || ''}
          />
          <Kpi
            label={t('pair.gain')}
            value={fmtPct(cost.gainPct)}
            cls={deltaClass(cost.gainPct)}
            sub={cost.lotCost != null ? `${t('pair.lotCost')}: ${fmtMoney(cost.lotCost)}` : ''}
          />
        </div>
      )}
      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">{t('hist.quarter')}</th>
                <th className="l">{t('hist.filed')}</th>
                <th className="l">{t('pair.activity')}</th>
                <th>{t('pair.shares')}</th>
                <th>{t('pair.delta')}</th>
                <th>{t('pair.deltaPct')}</th>
                <th>{t('table.value')}</th>
                <th>{t('pair.weight')}</th>
                <th>{t('pair.avgClose')}</th>
                <th>{t('pair.range')}</th>
              </tr>
            </thead>
            <tbody>
              {[...d.rows].reverse().map((r) => (
                <tr key={r.reportDate}>
                  <td className="l"><b>{quarterLabel(r.reportDate)}</b></td>
                  <td className="l muted">{r.filed}</td>
                  <td className="l">
                    <span className={`tk ${r.activity === 'new' ? 'new' : r.activity === 'add' ? 'add' : r.activity === 'reduce' ? 'reduce' : r.activity === 'exit' ? 'exit' : ''}`} style={r.activity === 'hold' || r.activity === 'none' ? { color: 'var(--text-2)' } : {}}>
                      {t(`pair.act.${r.activity}`)}
                    </span>
                  </td>
                  <td className="num">{r.shares ? fmtNum(r.shares) : '—'}</td>
                  <td className={`num ${deltaClass(r.deltaShares)}`}>{r.deltaShares ? fmtNum(r.deltaShares) : '—'}</td>
                  <td className={`num ${deltaClass(r.deltaPct)}`}>{r.deltaPct != null ? fmtPct(r.deltaPct) : '—'}</td>
                  <td className="num">{r.value ? fmtMoney(r.value) : '—'}</td>
                  <td className="num">{r.weight ? fmtPct(r.weight, { sign: false, digits: 2 }) : '—'}</td>
                  <td className="num">{r.avgClose != null ? fmtPx(r.avgClose) : '—'}</td>
                  <td className="num muted">{r.lo != null ? `${fmtPx(r.lo)} – ${fmtPx(r.hi)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small mt8">{t('hist.splitNote')}</p>
        <p className="muted small mt8">{t('pair.costNote')}</p>
        <Disclaimer />
      </div>
    </div>
  );
}
