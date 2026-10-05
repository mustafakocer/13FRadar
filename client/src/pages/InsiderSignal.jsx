import { Fragment, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../i18n.jsx';
import CompanyName from '../components/CompanyName.jsx';
import { useAuth } from '../auth.jsx';
import ProGate from '../components/ProGate.jsx';
import { useSeo } from '../seo.jsx';
import { fmtMoney, fmtPct, fmtFormPrice } from '../lib/format.js';
import { breadcrumbs } from '../lib/seoTemplates.js';
import Ico from '../components/Ico.jsx';
import { Zap } from 'lucide-react';

const SIGNALS = ['cluster', 'csuite', 'penny'];
const ROLE_LABEL = { ceo: 'CEO', cfo: 'CFO', director: 'DIR', officer: 'OFF', owner10: '10%' };

// Public insider signal pages (cluster buys, C-suite buys, penny gems),
// rendered from the daily teaser file — the free entry point to the Pro feed.
export default function InsiderSignal() {
  const { signal } = useParams();
  const { t, lang } = useI18n();
  const { isPro } = useAuth();
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
  // groups that look like clusters but are an employee plan or an offering
  const lookalikes = kind === 'cluster' ? teaser.data?.signals?.clusterExcluded || [] : [];
  const [open, setOpen] = useState(() => new Set());
  const toggle = (tk) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(tk)) next.delete(tk);
      else next.add(tk);
      return next;
    });
  const own = (x) => (x === 'new' ? t('ins.cluster.newPosition') : x == null ? '—' : fmtPct(x, { digits: 1 }));
  const FREE = 10;
  const shown = isPro ? rows : rows.slice(0, FREE);
  const title = t(`landing.ins.tab.${kind}`);
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? `${title} — Son 30 Günün Insider Alımları | Fundocap` : `${title} — Insider Buys, Last 30 Days | Fundocap`,
        description:
          lang === 'tr'
            ? `${rows.length} ${title.toLowerCase()} (SEC Form 4). ${rows[0] ? `Öne çıkan: ${rows[0].t}${rows[0].insiders ? `, ${rows[0].insiders} insider` : ''}, ${fmtMoney(rows[0].v)}.` : ''} Günlük güncellenir.`
            : `${rows.length} ${title.toLowerCase()} from SEC Form 4. ${rows[0] ? `Top: ${rows[0].t}${rows[0].insiders ? `, ${rows[0].insiders} insiders` : ''}, ${fmtMoney(rows[0].v)}.` : ''} Updated daily.`,
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
          <h1><Ico icon={Zap} size={22} /> {title}</h1>
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
              {shown.map((r) => (
                <Fragment key={`${r.t}-${r.n || ''}`}>
                <tr>
                  <td className="l">
                    <Link to={`/stock/${r.t}`} className="sig-tick">{r.t}</Link>
                    <div className="sig-co"><CompanyName name={r.c} /></div>
                  </td>
                  <td className="l">
                    {kind === 'cluster' ? (
                      <>
                        {r.insiders} {t('landing.ins.insiders')}{' '}
                        {(r.roles || []).map((x) => <span key={x} className={`role-badge ${x}`}>{ROLE_LABEL[x]}</span>)}
                        {r.fpi && <span className="badge sm plain" title={t('ins.fpi.tip')} data-fpi>{t('ins.fpi.badge')}</span>}
                        {r.own != null && <div className="muted small" title={t('ins.cluster.ownTip')}>{t('ins.cluster.own')}: {own(r.own)}</div>}
                        {r.members?.length > 0 && (
                          <button type="button" className="link-btn small" onClick={() => toggle(r.t)} aria-expanded={open.has(r.t)} data-cluster-detail={r.t}>
                            {open.has(r.t) ? t('ins.cluster.hide') : t('ins.cluster.details')}
                          </button>
                        )}
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
                {kind === 'cluster' && open.has(r.t) && (
                  <tr className="cluster-detail">
                    <td colSpan={4} className="l">
                      <div className="small"><b>{t('ins.cluster.members')}</b></div>
                      <table className="data compact">
                        <tbody>
                          {r.members.map((m) => (
                            <tr key={m.n}>
                              <td className="l">{m.n}</td>
                              <td className="l"><span className={`role-badge ${m.r}`}>{ROLE_LABEL[m.r] || m.r}</span>{m.ti ? <span className="muted small"> {m.ti}</span> : null}</td>
                              <td className="l">{m.d}</td>
                              <td>{fmtMoney(m.v)}</td>
                              <td title={t('ins.cluster.ownTip')}>{own(m.own)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {r.others?.length > 0 && (
                        <>
                          <div className="small mt8"><b>{t('ins.cluster.others')}</b></div>
                          <table className="data compact">
                            <tbody>
                              {r.others.map((o) => (
                                <tr key={o.n}>
                                  <td className="l">{o.n}</td>
                                  <td className="l"><span className={`role-badge ${o.r}`}>{ROLE_LABEL[o.r] || o.r}</span></td>
                                  <td className="l">{o.d}</td>
                                  <td>{o.v ? fmtMoney(o.v) : '—'}</td>
                                  <td className="l muted small" data-why={o.why}>{t(`ins.cluster.why.${o.why}`)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {teaser.data?.lastDay && (
          <p className="muted small mt8">{t('landing.ins.asOf')}: {teaser.data.lastDay} · {kind === 'cluster' ? t('ins.cluster.rule') : t('ins.note')}</p>
        )}
      </div>
      {lookalikes.length > 0 && (
        <div className="card mt16" data-cluster-excluded>
          <h2 className="h3">{t('ins.cluster.excludedTitle')}</h2>
          <p className="muted small">{t('ins.cluster.excludedNote')}</p>
          <div className="table-wrap">
            <table className="data sig">
              <tbody>
                {lookalikes.map((e) => (
                  <tr key={e.t}>
                    <td className="l">
                      <Link to={`/stock/${e.t}`} className="sig-tick">{e.t}</Link>
                      <div className="sig-co">{e.c || '—'}</div>
                    </td>
                    <td className="l">
                      <span className="badge sm plain" data-label={e.label} title={e.label === 'program_same_price' ? t('ins.cluster.programTip') : undefined}>{t(`ins.cluster.label.${e.label}`)}</span>{' '}
                      {e.fpi && <span className="badge sm plain" title={t('ins.fpi.tip')} data-fpi>{t('ins.fpi.badge')}</span>}{' '}
                      {e.label !== 'program_same_price' && <>{e.people} {t('landing.ins.insiders')}</>}
                      {e.label === 'program_same_price' && (
                        <div className="muted small" data-program-line>
                          {t('ins.cluster.programLine')
                            .replace('{n}', e.people)
                            .replace('{d}', e.d || e.from)
                            .replace('{price}', fmtFormPrice(e.cu, e.price))
                            .replace('{dev}', Number(e.maxDevPct || 0).toFixed(2).replace('.', lang === 'tr' ? ',' : '.'))
                            .replace('{v}', fmtMoney(e.value))}
                        </div>
                      )}
                      {e.quote && <div className="muted small" title={e.quote}>“{e.quote.length > 110 ? `${e.quote.slice(0, 110)}…` : e.quote}”</div>}
                      {!e.quote && e.median != null && <div className="muted small">{t('ins.cluster.sameDay').replace('{m}', fmtMoney(e.median))}</div>}
                    </td>
                    <td className="l">{e.from === e.to ? e.from : `${e.from} → ${e.to}`}</td>
                    <td className="sig-val">{fmtMoney(e.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {rows.length > 0 && <ProGate remaining={rows.length - shown.length} unit={t('paywall.unit.signals')} note={t('paywall.previewSignals')} />}
    </div>
  );
}
