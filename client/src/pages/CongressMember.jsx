import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gavel } from 'lucide-react';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format.js';
import { breadcrumbs } from '../lib/seoTemplates.js';
import { webPage } from '../lib/jsonld.js';
import AnswerBox from '../components/AnswerBox.jsx';
import Ico from '../components/Ico.jsx';
import TickerLogo from '../components/TickerLogo.jsx';
import CongressTable, { CongressDisclaimer, partyClass } from '../components/CongressTable.jsx';

const HOUR = 60 * 60 * 1000;

// /congress/:slug — one member's disclosed trades.
export default function CongressMember() {
  const { slug } = useParams();
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ['congress-member', slug], queryFn: () => api.congressMember(slug), staleTime: HOUR, retry: false });
  const d = q.data;
  const m = d?.member;
  const seat = m ? (m.ch === 'S' ? t('cg.senatorOf') : t('cg.repOf')).replace('{st}', m.st || '—').replace('{dist}', m.dist != null ? `-${m.dist}` : '') : '';
  const answer = m
    ? (lang === 'tr'
        ? '{n} ({p}, {seat}) {trades} işlem bildirdi: {buys} alım, {sells} satış, tahmini toplam ~{vol}. Son bildirim {last}. En büyük işlem gördüğü hisse: {top}.'
        : '{n} ({p}, {seat}) has disclosed {trades} trades: {buys} buys and {sells} sells, an estimated ~{vol} in total. Latest disclosure {last}. Largest position by volume: {top}.')
        .replace('{n}', m.n)
        .replace('{p}', m.p ? t(`cg.party.${m.p}`) : t('cg.partyUnknown'))
        .replace('{seat}', seat)
        .replace('{trades}', fmtNum(m.trades))
        .replace('{buys}', fmtNum(m.buys))
        .replace('{sells}', fmtNum(m.sells))
        .replace('{vol}', fmtMoney(m.volume))
        .replace('{last}', m.last || '—')
        .replace('{top}', d.tickers?.[0]?.t || '—')
    : null;
  useSeo(
    useMemo(
      () => ({
        title: m ? (lang === 'tr' ? `${m.n} Hisse İşlemleri ve Portföyü (Kongre) | Fundocap` : `${m.n} Stock Trades & Portfolio (Congress) | Fundocap`) : 'Fundocap',
        description: answer ? answer.slice(0, 155) : undefined,
        answer,
        path: `/congress/${slug}`,
        dateModified: d?.updatedAt?.slice(0, 10) || null,
        noindex: q.isError,
        jsonLd: m
          ? [
              webPage({ name: lang === 'tr' ? `${m.n} hisse işlemleri` : `${m.n} stock trades`, description: answer, lang, path: `/congress/${slug}`, dateModified: d.updatedAt }),
              {
                '@context': 'https://schema.org',
                '@type': 'Person',
                name: m.n,
                jobTitle: m.ch === 'S' ? 'United States Senator' : 'Member of the United States House of Representatives',
                ...(m.bg ? { sameAs: [`https://bioguide.congress.gov/search/bio/${m.bg}`] } : {}),
              },
              breadcrumbs(lang, [
                [lang === 'tr' ? 'Kongre İşlemleri' : 'Congress Trades', '/congress'],
                [m.n, `/congress/${slug}`],
              ]),
            ]
          : [],
      }),
      [lang, d, m, answer, slug, q.isError]
    )
  );
  if (q.isLoading) return <div className="loading"><div className="spinner" />{t('common.loading')}</div>;
  if (!m) return <div className="error-box">{t('cg.memberMissing')} <Link to="/congress">{t('cg.backToAll')}</Link></div>;
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="muted small"><Link to="/congress">{t('cg.title')}</Link> ›</div>
          <h1><Ico icon={Gavel} size={22} /> {m.n}</h1>
          <div className="sub">
            {m.p ? <b className={partyClass(m.p)}>{t(`cg.party.${m.p}`)}</b> : t('cg.partyUnknown')} · {seat}
            {m.committees?.length > 0 && <> · {m.committees.map((c) => c.name).join(', ')}</>}
          </div>
        </div>
      </div>
      <AnswerBox text={answer} />

      <div className="fund-stats mt16">
        <div className="fund-stat">
          <span className="k">{t('cg.trades')}</span>
          <b>{fmtNum(m.trades)}</b>
          <span className="s"><span className="text-buy">{fmtNum(m.buys)} {t('cg.buys').toLowerCase()}</span> · <span className="text-sell">{fmtNum(m.sells)} {t('cg.sells').toLowerCase()}</span></span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.volume')}</span>
          <b>~{fmtMoney(m.volume)}</b>
          <span className="s">{t('cg.volumeTip')}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.avgRet')}</span>
          <b>{m.avgBuyRet != null ? <span className={m.avgBuyRet >= 0 ? 'delta-pos' : 'delta-neg'}>{fmtPct(m.avgBuyRet * 100)}</span> : '—'}</b>
          <span className="s">{t('cg.avgRetNote').replace('{n}', fmtNum(m.pricedBuys))}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.lastFiled')}</span>
          <b>{m.last || '—'}</b>
          <span className="s">{t('cg.lastTrade')}: {m.lastTrade || '—'}</span>
        </div>
      </div>

      {d.tickers?.length > 0 && (
        <div className="card mt16">
          <h3>{t('cg.topTickers')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('cg.asset')}</th>
                  <th>{t('cg.buys')}</th>
                  <th>{t('cg.sells')}</th>
                  <th title={t('cg.volumeTip')}>{t('cg.volume')}</th>
                  <th>{t('cg.lastTrade')}</th>
                  <th>{t('cg.price')}</th>
                </tr>
              </thead>
              <tbody>
                {d.tickers.map((r) => (
                  <tr key={r.t}>
                    <td className="l">
                      <Link to={`/stock/${r.t}`} className="tk-cell"><TickerLogo ticker={r.t} size={24} /> <b>{r.t}</b></Link>
                      <div className="muted small" style={{ maxWidth: 320 }}>{r.a}</div>
                    </td>
                    <td className="num">{fmtNum(r.buys)}</td>
                    <td className="num">{fmtNum(r.sells)}</td>
                    <td className="num">~{fmtMoney(r.volume)}</td>
                    <td className="num muted">{r.last}</td>
                    <td className="num muted">{r.cur != null ? fmtNum(r.cur, 2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card mt16">
        <h3>{t('cg.allTrades')}</h3>
        <CongressTable rows={d.rows} showMember={false} />
        <p className="muted small mt8">{t('cg.memberNote')}</p>
        <CongressDisclaimer />
      </div>
    </div>
  );
}
