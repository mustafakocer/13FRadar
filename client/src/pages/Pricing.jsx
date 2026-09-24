import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { api } from '../lib/api.js';
import Ico from '../components/Ico.jsx';
import { Gift, Check } from 'lucide-react';

// The USD list prices, the same numbers api/_lib/plans.js carries: what the
// page shows before /api/plans has answered (and in a build without it).
export const PRICES = { global: { m: 19.9, y: 199 }, tr: { m: 10, y: 100 } };
const FALLBACK = { region: 'global', currency: 'USD', m: PRICES.global.m, y: PRICES.global.y, discountPct: 17, fx: null, anchorUsd: null, configured: false };

const FREE_FEATURES = ['pf1', 'pf2', 'pf3', 'pf4'];
const PRO_FEATURES = ['pp1', 'pp2', 'pp3', 'pp4', 'pp5', 'pp6', 'pp7', 'pp8'];

// One currency on the page: the one the catalog says this visitor pays in.
export function money(v, currency, lang) {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', lang === 'tr' ? ',' : '.');
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'tr' ? '.' : ',');
  return currency === 'TRY' ? `₺${grouped}` : `$${grouped}`;
}

export default function Pricing() {
  const { t, lang } = useI18n();
  const { user, isPro, configured, loading } = useAuth();
  const [params, setParams] = useSearchParams();
  // ?plan=pro_monthly|pro_yearly: the plan a signed-out reader picked
  // before signing in; the page starts that checkout as soon as it can
  const wanted = /^pro_(monthly|yearly)$/.test(params.get('plan') || '') ? params.get('plan') : null;
  const [cycle, setCycle] = useState(wanted === 'pro_yearly' ? 'y' : 'm'); // m | y
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Fiyatlandırma: Ücretsiz ve Pro Planlar | Fundocap' : 'Pricing: Free and Pro Plans | Fundocap',
        description: lang === 'tr' ? 'Ücretsiz planla fon arama ve ilk 10 pozisyon; Pro ile tam portföyler, alım-satımlar, insider akışı ve dışa aktarma.' : 'Free: fund search and top-10 positions. Pro: full portfolios, buys and sells, the insider feed and exports.',
        path: '/pricing',
      }),
      [lang, t]
    )
  );

  const plans = useQuery({ queryKey: ['plans'], queryFn: api.plans, staleTime: 5 * 60 * 1000, retry: 0 });
  const cat = plans.data || FALLBACK;

  // Stripe Checkout session is created on the server (it also decides the
  // regional price and currency from the visitor's IP), then we redirect.
  const startCheckout = async (c = cycle) => {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await api.checkout(c);
      window.location.assign(url);
    } catch (e) {
      setErr(e.status === 503 ? t('pricing.soon') : e.status === 409 ? t('pricing.current') : t('pricing.checkoutError'));
      setBusy(false);
    }
  };

  // Back from sign-in with the plan in the URL: straight to Checkout, once.
  const started = useRef(false);
  useEffect(() => {
    if (!wanted || started.current || loading || !configured) return;
    if (!user || isPro) return;
    started.current = true;
    const c = wanted === 'pro_yearly' ? 'y' : 'm';
    setCycle(c);
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('plan');
      return next;
    }, { replace: true });
    startCheckout(c);
  }, [wanted, loading, configured, user, isPro]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = cat.currency;
  const price = money(cycle === 'm' ? cat.m : cat.y, cur, lang);
  const perMonthOfYear = cat.y > 0 ? money(cat.y / 12, cur, lang) : null;
  // the reference struck through: the global USD price on a TR card
  const anchor = cat.anchorUsd && cur === 'USD' ? money(cycle === 'm' ? cat.anchorUsd.m : cat.anchorUsd.y, 'USD', lang) : null;
  const approx = cat.fx?.approx ? money(cycle === 'm' ? cat.fx.approx.m : cat.fx.approx.y, 'TRY', lang) : null;
  const planParam = cycle === 'y' ? 'pro_yearly' : 'pro_monthly';
  const signInHref = `/account?next=${encodeURIComponent(`/pricing?plan=${planParam}`)}`;

  return (
    <div>
      <div className="hero" style={{ padding: '24px 0 8px' }}>
        <h1>{t('pricing.title')}</h1>
        <p>{t('pricing.subtitle')}</p>
      </div>

      <div className="row" style={{ justifyContent: 'center', marginBottom: 18 }}>
        {['m', 'y'].map((c) => (
          <button key={c} className={`chip${cycle === c ? ' fsel-active' : ''}`} onClick={() => setCycle(c)}>
            {c === 'm' ? t('pricing.billMonthly') : t('pricing.billYearly')}
            {c === 'y' && cat.discountPct > 0 && <> · <Ico icon={Gift} size={14} /> {t('pricing.discountShort').replace('{p}', cat.discountPct)}</>}
          </button>
        ))}
      </div>

      <div className="grid grid-2" style={{ maxWidth: 860, margin: '0 auto' }} data-currency={cur}>
        <div className="card">
          <h3>{t('pricing.free')}</h3>
          <div className="price-big">{money(0, cur, lang)}</div>
          <div className="muted small" style={{ marginBottom: 14 }}>{t('pricing.forever')}</div>
          {FREE_FEATURES.map((k) => (
            <div key={k} className="kv"><span className="k"><Ico icon={Check} /> {t(`pricing.${k}`)}</span></div>
          ))}
        </div>
        <div className="card" style={{ borderColor: 'var(--pro)', borderWidth: 2 }}>
          <h3>
            {t('pricing.pro')} <span className="badge pro">{t('pricing.popular')}</span>
          </h3>
          <div className="price-big" data-price>
            {price}
            {anchor && (
              <span className="muted" style={{ fontSize: 16, fontWeight: 500, marginLeft: 8, textDecoration: 'line-through' }}>
                {anchor}
              </span>
            )}
          </div>
          <div className="muted small" style={{ marginBottom: 14 }}>
            {cycle === 'm' ? t('pricing.monthly') : t('pricing.yearlySub')}
            {approx && <div>{t('pricing.approx').replace('{try}', approx)} · {t('pricing.fxNote').replace('{rate}', String(cat.fx.rate)).replace('{d}', cat.fx.asOf)}</div>}
            {cycle === 'y' && cat.discountPct > 0 && (
              <div className="badge info" style={{ marginTop: 6 }}>
                <Ico icon={Gift} size={14} /> {t('pricing.discount').replace('{p}', cat.discountPct).replace('{y}', money(cat.y, cur, lang))}
                {perMonthOfYear && <> · {t('pricing.perMonthEq').replace('{m}', perMonthOfYear)}</>}
              </div>
            )}
          </div>
          {PRO_FEATURES.map((k) => (
            <div key={k} className="kv"><span className="k"><Ico icon={Check} /> {t(`pricing.${k}`)}</span></div>
          ))}
          <div className="mt16">
            {isPro && configured ? (
              <span className="badge pro">{t('pricing.current')}</span>
            ) : !user && configured ? (
              <Link to={signInHref} className="btn" style={{ textDecoration: 'none' }} data-cta="start-pro">
                {t('pricing.startPro')}
              </Link>
            ) : (
              <button className="btn" onClick={() => startCheckout()} disabled={busy} data-cta="subscribe">
                {busy ? t('pricing.redirecting') : t('pricing.startPro')}
              </button>
            )}
            {err && <div className="muted small" style={{ marginTop: 8 }}>{err}</div>}
          </div>
        </div>
      </div>

      <p className="muted small" style={{ textAlign: 'center', marginTop: 24 }}>
        {t('pricing.note')}
      </p>
    </div>
  );
}
