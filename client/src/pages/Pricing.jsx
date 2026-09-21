import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { useGeo } from '../hooks/useGeo.js';
import { api } from '../lib/api.js';
import Ico from '../components/Ico.jsx';
import { Gift, Check } from 'lucide-react';

// USD list prices, matching the Stripe products in docs/STRIPE-KURULUM.md
// (yearly = 10 × monthly, "2 months free").
export const PRICES = { global: { m: 19.9, y: 199 }, tr: { m: 10, y: 100 } };

const FREE_FEATURES = ['pf1', 'pf2', 'pf3', 'pf4'];
const PRO_FEATURES = ['pp1', 'pp2', 'pp3', 'pp4', 'pp5', 'pp6', 'pp7', 'pp8'];

export default function Pricing() {
  const { t, lang } = useI18n();
  const { user, isPro, configured } = useAuth();
  const geo = useGeo();
  const [cycle, setCycle] = useState('m'); // m | y
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

  // Stripe Checkout session is created on the server (it also decides the
  // regional price from the visitor's IP), then we redirect to Stripe.
  const startCheckout = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await api.checkout(cycle);
      window.location.assign(url);
    } catch (e) {
      setErr(e.status === 503 ? t('pricing.soon') : t('pricing.checkoutError'));
      setBusy(false);
    }
  };

  const isTR = geo.data?.country === 'TR';
  // What Stripe actually charges (docs/STRIPE-KURULUM.md): the TR card shows
  // the global price struck through as its reference, and a yearly plan shows
  // twelve months at the monthly rate — the only anchors that correspond to a
  // real price. The old "$15" had no Stripe price behind it.
  const region = isTR ? PRICES.tr : PRICES.global;
  const usd = (v) => `$${Number.isInteger(v) ? v : v.toFixed(2).replace('.', lang === 'tr' ? ',' : '.')}`;
  const price = usd(cycle === 'm' ? region.m : region.y);
  const anchor = cycle === 'm' ? (isTR ? usd(PRICES.global.m) : null) : usd((isTR ? PRICES.tr.m : PRICES.global.m) * 12);

  return (
    <div>
      <div className="hero" style={{ padding: '24px 0 8px' }}>
        <h1>{t('pricing.title')}</h1>
        <p>{t('pricing.subtitle')}</p>
      </div>

      <div className="row" style={{ justifyContent: 'center', marginBottom: 18 }}>
        {['m', 'y'].map((c) => (
          <button
            key={c}
            className={`chip${cycle === c ? ' fsel-active' : ''}`}
            onClick={() => setCycle(c)}
          >
            {c === 'm' ? t('pricing.billMonthly') : t('pricing.billYearly')}
            {c === 'y' && <> · <Ico icon={Gift} size={14} /> {t('pricing.twoFree')}</>}
          </button>
        ))}
      </div>

      <div className="grid grid-2" style={{ maxWidth: 860, margin: '0 auto' }}>
        <div className="card">
          <h3>{t('pricing.free')}</h3>
          <div className="price-big">₺0</div>
          <div className="muted small" style={{ marginBottom: 14 }}>{t('pricing.forever')}</div>
          {FREE_FEATURES.map((k) => (
            <div key={k} className="kv"><span className="k"><Ico icon={Check} /> {t(`pricing.${k}`)}</span></div>
          ))}
        </div>
        <div className="card" style={{ borderColor: 'var(--pro)', borderWidth: 2 }}>
          <h3>
            {t('pricing.pro')} <span className="badge pro">{t('pricing.popular')}</span>
          </h3>
          <div className="price-big">
            {price}
            {anchor && (
              <span
                className="muted"
                style={{ fontSize: 16, fontWeight: 500, marginLeft: 8, textDecoration: 'line-through' }}
              >
                {anchor}
              </span>
            )}
          </div>
          <div className="muted small" style={{ marginBottom: 14 }}>
            {cycle === 'm' ? t('pricing.monthly') : t('pricing.yearlySub')}
            {cycle === 'y' && (
              <div className="badge info" style={{ marginTop: 6 }}><Ico icon={Gift} size={14} /> {t('pricing.twoFree')}</div>
            )}
          </div>
          {PRO_FEATURES.map((k) => (
            <div key={k} className="kv"><span className="k"><Ico icon={Check} /> {t(`pricing.${k}`)}</span></div>
          ))}
          <div className="mt16">
            {isPro && configured ? (
              <span className="badge pro">{t('pricing.current')}</span>
            ) : !user && configured ? (
              <Link to="/account?next=/pricing" className="btn" style={{ textDecoration: 'none' }}>
                {t('pricing.signInFirst')}
              </Link>
            ) : (
              <button className="btn" onClick={startCheckout} disabled={busy}>
                {busy ? t('pricing.redirecting') : t('pricing.subscribe')}
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
