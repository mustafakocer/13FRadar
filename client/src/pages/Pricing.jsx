import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { useGeo } from '../hooks/useGeo.js';

const CO = {
  m: import.meta.env.VITE_CHECKOUT_URL || '',
  mTR: import.meta.env.VITE_CHECKOUT_URL_TR || import.meta.env.VITE_CHECKOUT_URL || '',
  y: import.meta.env.VITE_CHECKOUT_URL_YEARLY || import.meta.env.VITE_CHECKOUT_URL || '',
  yTR:
    import.meta.env.VITE_CHECKOUT_URL_YEARLY_TR ||
    import.meta.env.VITE_CHECKOUT_URL_YEARLY ||
    import.meta.env.VITE_CHECKOUT_URL ||
    '',
};

const FREE_FEATURES = ['pf1', 'pf2', 'pf3', 'pf4'];
const PRO_FEATURES = ['pp1', 'pp2', 'pp3', 'pp4', 'pp5', 'pp6', 'pp7', 'pp8'];

export default function Pricing() {
  const { t } = useI18n();
  const { user, isPro, configured } = useAuth();
  const geo = useGeo();
  const [cycle, setCycle] = useState('m'); // m | y
  usePageTitle(`${t('pricing.title')} — 13F Radar`);

  const isTR = geo.data?.country === 'TR';
  // Anchored discount display (TR); annual = 10× monthly everywhere → "2 months free"
  const price = cycle === 'm' ? (isTR ? '$10' : t('pricing.proPrice')) : isTR ? '$100' : '$199';
  const anchor = cycle === 'm' ? (isTR ? '$15' : null) : isTR ? '$120' : '$238';
  const baseUrl = cycle === 'm' ? (isTR ? CO.mTR : CO.m) : isTR ? CO.yTR : CO.y;

  const checkoutHref =
    user && baseUrl
      ? `${baseUrl}?checkout[email]=${encodeURIComponent(user.email)}&checkout[custom][user_id]=${user.id}`
      : baseUrl;

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
            {c === 'y' && ` · 🎁 ${t('pricing.twoFree')}`}
          </button>
        ))}
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
              <div className="badge pos" style={{ marginTop: 6 }}>🎁 {t('pricing.twoFree')}</div>
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
