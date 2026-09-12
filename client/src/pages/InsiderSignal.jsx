import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney } from '../lib/format.js';
import { breadcrumbs } from '../lib/seoTemplates.js';

const SIGNALS = ['cluster', 'csuite', 'penny'];
const ROLE_LABEL = { ceo: 'CEO', cfo: 'CFO', director: 'DIR', officer: 'OFF', owner10: '10%' };

// Public insider signal pages (cluster buys, C-suite buys, penny gems),
// rendered from the daily teaser file — the free entry point to the Pro feed.
export default function InsiderSignal() {
  const { signal } = useParams();
  const { t, lang } = useI18n();
  const kind = SIGNALS.includes(signal) ? signal : 'cluster';
  const teaser = useQuery({
    queryKey: ['insiders-teaser'],
    queryFn: async () => {
      const r = await fetch('/insiders-teaser.json');
      return r.ok ? r.json() : null;
    },
    staleTime: Infinity,
  });
  const rows = teaser.data?.signals?.[kind] || [];
  const title = t(`landing.ins.tab.${kind}`);
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? `${title} — Son 30 Günün Insider Sinyalleri | 13F Radar` : `${title} — Insider Signals, Last 30 Days | 13F Radar`,
        description:
          lang === 'tr'
            ? `${rows.length} ${title.toLowerCase()} sinyali (SEC Form 4). ${rows[0] ? `Öne çıkan: ${rows[0].t}${rows[0].insiders ? `, ${rows[0].insiders} insider` : ''}, ${fmtMoney(rows[0].v)}.` : ''} Günlük güncellenir.`
            : `${rows.length} ${title.toLowerCase()} signals from SEC Form 4. ${rows[0] ? `Top: ${rows[0].t}${rows[0].insiders ? `, ${rows[0].insiders} insiders` : ''}, ${fmtMoney(rows[0].v)}.` : ''} Updated daily.`,
        path: `/insiders/${kind}`,
        jsonLd: [breadcrumbs(lang, [[t('nav.insiders'), '/insiders'], [title, `/insiders/${kind}`]])],
      }),
      [lang, kind, title, rows, t]
    )
  );
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>⚡ {title}</h1>
          <div className="sub">{t(`insig.${kind}.desc`)}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {SIGNALS.map((k) => (
          <Link key={k} to={`/insiders/${k}`} className={`chip${k === kind ? ' fsel-active' : ''}`}>
            {t(`landing.ins.tab.${k}`)}
          </Link>
        ))}
        <Link to="/insiders" className="chip">{t('landing.ins.cta')} →</Link>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="data sig">
            <thead>
              <tr>
                <th className="l">{t('landing.ins.th.ticker')}</th>
                <th className="l">{t('landing.ins.th.signal')}</th>
                <th className="l">{t('landing.ins.th.window')}</th>
                <th>{t('landing.ins.th.value')}</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length && (
                <tr><td className="l muted" colSpan={4}>{t('landing.ins.empty')}</td></tr>
              )}
              {rows.map((r) => (
                <tr key={`${r.t}-${r.n || ''}`}>
                  <td className="l">
                    <Link to={`/stock/${r.t}`} className="sig-tick">{r.t}</Link>
                    <div className="sig-co">{r.c || '—'}</div>
                  </td>
                  <td className="l">
                    {kind === 'cluster' ? (
                      <>
                        {r.insiders} {t('landing.ins.insiders')}{' '}
                        {(r.roles || []).map((x) => <span key={x} className={`role-badge ${x}`}>{ROLE_LABEL[x]}</span>)}
                      </>
                    ) : (
                      <>
                        <span className={`role-badge ${r.r}`}>{ROLE_LABEL[r.r] || r.r}</span> {r.n}
                      </>
                    )}
                  </td>
                  <td className="l">{kind === 'cluster' ? `${r.from} → ${r.to}` : `${r.d} @ $${Number(r.p).toFixed(2)}`}</td>
                  <td className="sig-val">{fmtMoney(r.v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {teaser.data?.lastDay && (
          <p className="muted small mt8">{t('landing.ins.asOf')}: {teaser.data.lastDay} · {t('ins.note')}</p>
        )}
      </div>
    </div>
  );
}
