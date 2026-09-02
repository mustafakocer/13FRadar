import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { useGeo } from '../hooks/useGeo.js';

const CHECKOUT_URL = import.meta.env.VITE_CHECKOUT_URL || '';
// Regional checkout for Turkey (separate Lemon Squeezy variant priced at $10)
const CHECKOUT_URL_TR = import.meta.env.VITE_CHECKOUT_URL_TR || CHECKOUT_URL;

const FREE_FEATURES = ['pf1', 'pf2', 'pf3', 'pf4'];
const PRO_FEATURES = ['pp1', 'pp2', 'pp3', 'pp4', 'pp5', 'pp6', 'pp7', 'pp8'];

export default function Pricing() {
  const { t } = useI18n();
  const { user, isPro, configured } = useAuth();
  const geo = useGeo();
  usePageTitle(`${t('pricing.title')} — 13F Radar`);

  const isTR = geo.data?.country === 'TR';
  const baseUrl = isTR ? CHECKOUT_URL_TR : CHECKOUT_URL;
  const price = isTR ? '$10' : t('pricing.proPrice');

  const checkoutHref = user && baseUrl
    ? `${baseUrl}?checkout[email]=${encodeURIComponent(user.email)}&checkout[custom][user_id]=${user.id}`
    : baseUrl;

  return (
    <div>
      <div className="hero" style={{ padding: '24px 0 16px' }}>
        <h1>{t('pricing.title')}</h1>
        <p>{t('pricing.subtitle')}</p>
      </div>

      <div className="grid grid-2" style={{ maxWidth: 860, margin: '0 auto' }}>
        <div className="card">
          <h3>{t('pricing.free')}</h3>
          <div className="price-big">₺0</div>
          <div className="muted small" style={{ marginBottom: 14 }}>{t('pricing.forever')}</div>
          {FREE_FEATURES.map((k) => (
            <div key={k} className="kv"><span className="k">✓ {t(`pricing.${k}`)}</span></div>
          ))}
        </div>
        <div className="card" style={{ borderColor: 'var(--accent)', borderWidth: 2 }}>
          <h3>
            {t('pricing.pro')} <span className="badge pos">{t('pricing.popular')}</span>
          </h3>
          <div className="price-big">
            {price}
            {isTR && (
              <span className="muted" style={{ fontSize: 15, fontWeight: 500, marginLeft: 8, textDecoration: 'line-through' }}>
                {t('pricing.proPrice')}
              </span>
            )}
          </div>
          <div className="muted small" style={{ marginBottom: 14 }}>
            {t('pricing.monthly')}
            {isTR && (
              <div className="badge pos" style={{ marginTop: 6 }}>🇹🇷 {t('pricing.trNote')}</div>
            )}
          </div>
          {PRO_FEATURES.map((k) => (
            <div key={k} className="kv"><span className="k">✓ {t(`pricing.${k}`)}</span></div>
          ))}
          <div className="mt16">
            {isPro && configured ? (
              <span className="badge pos">{t('pricing.current')}</span>
            ) : !user && configured ? (
              <Link to="/account" className="btn" style={{ textDecoration: 'none' }}>
                {t('pricing.signInFirst')}
              </Link>
            ) : checkoutHref ? (
              <a href={checkoutHref} className="btn" style={{ textDecoration: 'none' }}>
                {t('pricing.subscribe')}
              </a>
            ) : (
              <span className="muted small">{t('pricing.soon')}</span>
            )}
          </div>
        </div>
      </div>

      <p className="muted small" style={{ textAlign: 'center', marginTop: 24 }}>
        {t('pricing.note')}
      </p>
    </div>
  );
}
