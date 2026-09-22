import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtNum, quarterLabel } from '../lib/format.js';
import { breadcrumbs } from '../lib/seoTemplates.js';
import { article, itemList } from '../lib/jsonld.js';
import AnswerBox from '../components/AnswerBox.jsx';
import CoverageLine from '../components/CoverageLine.jsx';
import Faq, { Disclaimer } from '../components/Faq.jsx';
import { managerPath } from '../lib/paths.js';
import Ico from '../components/Ico.jsx';
import { Calendar as CalendarIcon } from 'lucide-react';

const longDate = (iso, lang) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '—');

// /calendar — 13F filing calendar: next deadline, the four deadlines of the
// year, per-guru status for the current period, filings received recently.
export default function Calendar() {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ['calendar'], queryFn: api.calendar, staleTime: 60 * 60 * 1000 });
  const d = q.data;
  // live countdown after hydration only (server text stays static)
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);
  const remaining = useMemo(() => {
    if (!d?.next) return null;
    const ms = new Date(`${d.next.deadline}T00:00:00Z`) - (now || Date.now());
    return { days: Math.max(0, Math.floor(ms / 86400000)), hours: Math.max(0, Math.floor((ms % 86400000) / 3600000)) };
  }, [d, now]);

  const answer = d
    ? lang === 'tr'
      ? `Bir sonraki 13F son tarihi ${longDate(d.next.deadline, lang)} (${d.next.quarter} çeyreği, ${d.daysToNext} gün kaldı). ${d.period.quarter} dönemi için takip edilen ${d.gurus.length} usta yatırımcıdan ${d.filedCount}'i bildirimini yaptı. Evrende son 7 günde ${fmtNum(d.recent.last7d.length)} bildirim alındı (veri tarihi ${d.recent.asOf}).`
      : `The next 13F deadline is ${longDate(d.next.deadline, lang)} (${d.next.quarter} filings, ${d.daysToNext} days away). For the ${d.period.quarter} period, ${d.filedCount} of ${d.gurus.length} tracked superinvestors have filed. ${fmtNum(d.recent.last7d.length)} filings were received across the universe in the last 7 days (data as of ${d.recent.asOf}).`
    : null;
  const faq = d
    ? lang === 'tr'
      ? [
          ['13F bildirimleri ne zaman yapılır?', 'Form 13F, her takvim çeyreğinin bitiminden itibaren 45 gün içinde SEC\'e verilir: 31 Mart → 15 Mayıs, 30 Haziran → 14 Ağustos, 30 Eylül → 14 Kasım, 31 Aralık → 14 Şubat civarı; son gün hafta sonuna denk gelirse bir sonraki iş günü.'],
          [`${d.period.quarter} için hangi usta yatırımcılar bildirim yaptı?`, `${d.filedCount} / ${d.gurus.length}: ${d.gurus.filter((g) => g.status === 'filed').map((g) => g.name).join(', ') || '—'}.`],
        ]
      : [
          ['When are 13F filings due?', 'Form 13F is due within 45 days after each calendar quarter end: March 31 → May 15, June 30 → August 14, September 30 → November 14, December 31 → around February 14; a weekend deadline rolls to the next business day.'],
          [`Which superinvestors have filed for ${d.period.quarter}?`, `${d.filedCount} of ${d.gurus.length}: ${d.gurus.filter((g) => g.status === 'filed').map((g) => g.name).join(', ') || '—'}.`],
        ]
    : [];
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? `13F Bildirim Takvimi ${d ? d.next.quarter.split(' ').reverse().join(' ') : ''}: Son Tarihler ve Kim Bildirdi | Fundocap` : `13F Filing Calendar ${d ? d.next.quarter : ''}: Deadlines & Who Has Filed | Fundocap`,
        description: answer ? answer.slice(0, 155) : undefined,
        answer,
        path: '/calendar',
        dateModified: d?.recent?.asOf || null,
        jsonLd: d
          ? [
              article({ headline: lang === 'tr' ? '13F Bildirim Takvimi' : '13F Filing Calendar', description: answer, lang, path: '/calendar', datePublished: d.recent.asOf, dateModified: d.today }),
              itemList({ name: lang === 'tr' ? `${d.period.quarter} bildirim durumu` : `${d.period.quarter} filing status`, lang, items: d.gurus.map((g) => ({ name: `${g.name} — ${g.status}`, path: g.path })) }),
              ...(faq.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([qq, a]) => ({ '@type': 'Question', name: qq, acceptedAnswer: { '@type': 'Answer', text: a } })) }] : []),
              breadcrumbs(lang, [[lang === 'tr' ? 'Takvim' : 'Calendar', '/calendar']]),
            ]
          : [],
      }),
      [lang, d, answer, faq]
    )
  );

  if (q.isLoading) return <div className="loading"><div className="spinner" />{t('common.loading')}</div>;
  if (!d) return <div className="error-box">{t('common.error')}</div>;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1><Ico icon={CalendarIcon} size={22} /> {t('cal.title')}</h1>
          <div className="sub">{t('cal.subtitle')}</div>
        </div>
      </div>
      <AnswerBox text={answer} />

      <div className="grid grid-3">
        <div className="card stat-card">
          <span className="stat-label">{t('cal.next')}</span>
          <span className="stat-value">{remaining ? `${remaining.days}${t('cal.d')} ${remaining.hours}${t('cal.h')}` : `${d.daysToNext}${t('cal.d')}`}</span>
          <span className="stat-sub">{d.next.quarter} · {longDate(d.next.deadline, lang)}</span>
        </div>
        <div className="card stat-card">
          <span className="stat-label">{t('cal.filedStatus')} · {d.period.quarter}</span>
          <span className="stat-value">{d.filedCount} / {d.gurus.length}</span>
          <span className="stat-sub">{t('cal.gurusFiled')}</span>
          <CoverageLine coverage={d.coverage} className="small muted" />
        </div>
        <div className="card stat-card">
          <span className="stat-label">{t('cal.recent7d')}</span>
          <span className="stat-value">{fmtNum(d.recent.last7d.length)}</span>
          <span className="stat-sub">{t('cal.asOf')} {d.recent.asOf} · {t('cal.last24h')}: {d.recent.last24h.length}</span>
        </div>
      </div>

      <div className="grid grid-2 mt16">
        <div className="card">
          <h3>{t('cal.deadlines')}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th className="l">{t('hist.quarter')}</th><th className="l">{t('cal.quarterEnd')}</th><th className="l">{t('cal.deadline')}</th><th>{t('cal.status')}</th></tr></thead>
              <tbody>
                {d.deadlines.map((x) => (
                  <tr key={x.quarterEnd}>
                    <td className="l"><b>{x.quarter}</b></td>
                    <td className="l">{x.quarterEnd}</td>
                    <td className="l">{x.deadline}</td>
                    <td className="num">{x.deadline < d.today ? <span className="badge plain">{t('cal.past')}</span> : x.quarterEnd === d.next.quarterEnd ? <span className="badge info">{t('cal.upcoming')}</span> : <span className="badge plain">{t('cal.future')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small mt8">{t('cal.rule')}</p>
        </div>
        <div className="card">
          <h3>{t('cal.guruStatus')} · {d.period.quarter}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th className="l">{t('screen.manager')}</th><th className="l">{t('cal.latestQuarter')}</th><th className="l">{t('hist.filed')}</th><th>{t('cal.status')}</th></tr></thead>
              <tbody>
                {d.gurus.map((g) => (
                  <tr key={g.cik}>
                    <td className="l"><Link to={g.path} style={{ fontWeight: 700 }}>{g.name}</Link></td>
                    <td className="l">{g.reportDate ? quarterLabel(g.reportDate) : '—'}</td>
                    <td className="l muted">{g.filed || '—'}</td>
                    <td className="num"><span className={`badge ${g.status === 'filed' ? 'info' : 'plain'}`}>{t(`cal.s.${g.status}`)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card mt16">
        <h3>{t('cal.recentTitle')} · {t('cal.asOf')} {d.recent.asOf}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th className="l">{t('screen.manager')}</th><th className="l">{t('hist.filed')}</th><th>{t('manager.aum')}</th><th>{t('manager.positions')}</th></tr></thead>
            <tbody>
              {d.recent.last7d.slice(0, 50).map((r) => (
                <tr key={r.cik}>
                  <td className="l"><Link to={managerPath(r.cik, r.path)}>{r.name}</Link></td>
                  <td className="l">{r.filed}</td>
                  <td className="num">{fmtMoney(r.aum)}</td>
                  <td className="num">{fmtNum(r.positions)}</td>
                </tr>
              ))}
              {!d.recent.last7d.length && <tr><td className="l muted" colSpan={4}>{t('common.na')}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small mt8">{t('cal.recentNote')}</p>
      </div>
      <Faq items={faq} />
      <Disclaimer />
    </div>
  );
}
