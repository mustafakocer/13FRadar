import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { fmtMoney, fmtPct, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { useAuth } from '../auth.jsx';
import Paywall from '../components/Paywall.jsx';
import { managerPath } from '../lib/paths.js';
import Ico from '../components/Ico.jsx';
import { Newspaper, ShoppingCart, Banknote, Crown } from 'lucide-react';

const Sym = ({ r }) =>
  r.ticker ? (
    <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }}>
      {r.ticker}
    </Link>
  ) : (
    <b>{r.issuer}</b>
  );

// Auto-generated quarterly season recap in plain language.
export default function Report() {
  const { t, lang } = useI18n();
  const { isPro } = useAuth();
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? `${t('report.title')} — Usta Yatırımcıların Çeyrek Özeti | 13F Radar` : `${t('report.title')} — Superinvestor Quarter Recap | 13F Radar`,
        description: lang === 'tr' ? 'Efsane fonların bu çeyrek en çok aldığı ve sattığı hisseler, yeni pozisyonlar ve yönetici bazlı özet.' : 'What legendary funds bought and sold this quarter, new positions and a per-manager recap.',
        path: '/report',
      }),
      [lang, t]
    )
  );
  const { data, isLoading, error } = useConsensusStatic();

  if (isLoading)
    return (
      <div className="loading">
        <div className="spinner" />
        {t('common.loading')}
      </div>
    );
  if (error)
    return <div className="error-box">{t('common.error')}: {String(error.message)}</div>;

  const { managers = [], mostHeld = [], topBought = [], topSold = [], newPositions = [] } = data;

  // dominant report quarter
  const counts = {};
  for (const m of managers) counts[m.reportDate] = (counts[m.reportDate] || 0) + 1;
  const quarter = quarterLabel(
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
  );

  // per-manager fresh buys
  const byManager = new Map();
  for (const p of newPositions) {
    const cur = byManager.get(p.cik) || { name: p.manager, cik: p.cik, buys: [] };
    cur.buys.push(p);
    byManager.set(p.cik, cur);
  }
  const managerRows = [...byManager.values()].sort((a, b) => b.buys.length - a.buys.length);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1><Ico icon={Newspaper} size={22} /> {t('report.title')}</h1>
          <div className="sub">
            <b>{quarter}</b> {t('report.subtitle')} · {managers.length} {t('report.funds')}
          </div>
        </div>
      </div>

      {!isPro && <Paywall />}

      {isPro && (
      <div className="grid grid-2">
        <div className="card">
          <h3><Ico icon={ShoppingCart} /> {t('report.bought')}</h3>
          {topBought.slice(0, 5).map((r, i) => (
            <div className="pos-row" key={r.cusip}>
              <div>
                <span className="muted small">{i + 1}. </span>
                <Sym r={r} /> <span className="muted small">{r.issuer}</span>
              </div>
              <div className="right">
                <span className="delta-pos w">{fmtMoney(r.netValue)}</span>
                <div className="muted small">{r.buyers} {t('report.fundsBought')}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="card">
          <h3><Ico icon={Banknote} /> {t('report.sold')}</h3>
          {topSold.slice(0, 5).map((r, i) => (
            <div className="pos-row" key={r.cusip}>
              <div>
                <span className="muted small">{i + 1}. </span>
                <Sym r={r} /> <span className="muted small">{r.issuer}</span>
              </div>
              <div className="right">
                <span className="delta-neg w">{fmtMoney(r.netValue)}</span>
                <div className="muted small">{r.sellers} {t('report.fundsSold')}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      <div className="card mt16">
        <h3><Ico icon={Crown} /> {t('report.kings')}</h3>
        <p className="muted small" style={{ marginBottom: 8 }}>{t('report.kingsNote')}</p>
        <div className="row" style={{ gap: 8 }}>
          {mostHeld.slice(0, 8).map((r) => (
            <span key={r.cusip} className="chip" style={{ cursor: 'default' }}>
              <Sym r={r} />
              <span className="muted small"> · {r.holderCount} {t('report.funds')}</span>
            </span>
          ))}
        </div>
      </div>

      {isPro && (
      <div className="card mt16">
        <h3><Ico icon={Newspaper} /> {t('report.byManager')}</h3>
        {managerRows.length === 0 && <div className="muted small">{t('common.na')}</div>}
        {managerRows.map((m) => (
          <div className="pos-row" key={m.cik} style={{ alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <Link to={managerPath(m.cik)} style={{ fontWeight: 700 }}>
                {m.name}
              </Link>{' '}
              <span className="muted">
                {t('report.enteredA')} {m.buys.length} {t('report.enteredB')}
              </span>
              <div className="small" style={{ marginTop: 2 }}>
                {m.buys.slice(0, 5).map((p, i) => (
                  <span key={p.cusip}>
                    {i > 0 && ' · '}
                    <Sym r={p} />
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

      <p className="muted small mt16">{t('report.note')}</p>
    </div>
  );
}
