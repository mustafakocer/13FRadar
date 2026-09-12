import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format.js';
import { breadcrumbs } from '../lib/seoTemplates.js';
import { article, itemList } from '../lib/jsonld.js';
import AnswerBox from '../components/AnswerBox.jsx';
import { Disclaimer } from '../components/Faq.jsx';
import { managerPath } from '../lib/paths.js';

// /emerging-managers — small, concentrated 13F filers ($100M–$1B, top-10 ≥ 50%).
export default function Emerging() {
  const { t, lang } = useI18n();
  const q = useQuery({ queryKey: ['emerging'], queryFn: api.emerging, staleTime: 24 * 60 * 60 * 1000 });
  const [sort, setSort] = useState({ key: 'top10', dir: -1 });
  const d = q.data;
  const rows = useMemo(() => {
    const r = [...(d?.rows || [])];
    r.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir;
    });
    return r;
  }, [d, sort]);
  const answer = d
    ? lang === 'tr'
      ? `${fmtNum(d.total)} kurum 13F evreninde "yükselen yönetici" ölçütünü karşılıyor: 100 milyon–1 milyar $ arası 13F varlığı ve ilk 10 pozisyonda %50 veya üzeri yoğunlaşma (veri tarihi ${d.updatedAt?.slice(0, 10)}). En yoğun portföy: ${rows[0]?.name} (ilk 10: %${rows[0]?.top10}).`
      : `${fmtNum(d.total)} filers in the 13F universe meet the emerging-manager screen: $100M–$1B in 13F assets and at least 50% of value in the top 10 positions (data as of ${d.updatedAt?.slice(0, 10)}). Most concentrated: ${rows[0]?.name} (top 10: ${rows[0]?.top10}%).`
    : null;
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Yükselen Fon Yöneticileri: Küçük ve Yoğun 13F Portföyleri | 13F Radar' : 'Emerging Managers: Small, Concentrated 13F Portfolios | 13F Radar',
        description: answer ? answer.slice(0, 155) : undefined,
        answer,
        path: '/emerging-managers',
        dateModified: d?.updatedAt?.slice(0, 10) || null,
        jsonLd: d
          ? [
              article({ headline: lang === 'tr' ? 'Yükselen Fon Yöneticileri' : 'Emerging Managers', description: answer, lang, path: '/emerging-managers', datePublished: d.updatedAt.slice(0, 10), dateModified: d.updatedAt.slice(0, 10) }),
              itemList({ name: lang === 'tr' ? 'Yükselen yöneticiler' : 'Emerging managers', lang, items: rows.slice(0, 50).map((r) => ({ name: r.name, path: r.path })) }),
              breadcrumbs(lang, [[lang === 'tr' ? 'Yükselen Yöneticiler' : 'Emerging Managers', '/emerging-managers']]),
            ]
          : [],
      }),
      [lang, d, answer, rows]
    )
  );
  const th = (key, label) => (
    <th className={key === 'name' ? 'l sortable' : 'sortable'} onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))}>
      {label}{sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}
    </th>
  );
  if (q.isLoading) return <div className="loading"><div className="spinner" />{t('common.loading')}</div>;
  if (!d) return <div className="error-box">{t('common.error')}</div>;
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🌱 {t('em.title')}</h1>
          <div className="sub">{t('em.subtitle')}</div>
        </div>
      </div>
      <AnswerBox text={answer} />
      <div className="card">
        <p className="muted small" style={{ marginBottom: 10 }}>
          {t('em.criteria')}{!d.criteria.smallCapAvailable && <> · <b>{t('em.smallCapTodo')}</b></>}
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">#</th>
                {th('name', t('screen.manager'))}
                {th('aum', t('manager.aum'))}
                {th('positions', t('manager.positions'))}
                {th('top10', t('manager.top10'))}
                {th('smallCapShare', t('em.smallCap'))}
                {th('filed', t('hist.filed'))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.cik}>
                  <td className="l muted">{i + 1}</td>
                  <td className="l"><Link to={managerPath(r.cik, r.path)} style={{ fontWeight: 700 }}>{r.name}</Link></td>
                  <td className="num">{fmtMoney(r.aum)}</td>
                  <td className="num">{fmtNum(r.positions)}</td>
                  <td className="num">{fmtPct(r.top10, { sign: false })}</td>
                  <td className="num muted">{r.smallCapShare != null ? fmtPct(r.smallCapShare, { sign: false }) : '—'}</td>
                  <td className="num muted">{r.filed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small mt8">{t('em.note').replace('{n}', fmtNum(d.total)).replace('{shown}', fmtNum(rows.length))}</p>
        <Disclaimer />
      </div>
    </div>
  );
}
