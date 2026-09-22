import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import Ico from '../components/Ico.jsx';
import { CircleCheck, CircleX } from 'lucide-react';

// Where Stripe sends the customer back: /checkout/success and
// /checkout/cancel. Success polls the plan for a few seconds (the webhook
// flips it) and then says "Pro is active" with the way to the account;
// cancel says nothing was charged.
export default function Checkout() {
  const { outcome } = useParams();
  const { t } = useI18n();
  const { plan, refreshPlan, user, configured } = useAuth();
  const ok = outcome === 'success';
  const [tries, setTries] = useState(0);
  useSeo({ title: `${ok ? t('checkout.successTitle') : t('checkout.cancelTitle')} — Fundocap`, description: '', path: `/checkout/${ok ? 'success' : 'cancel'}`, noindex: true });

  useEffect(() => {
    if (!ok || plan === 'pro' || !refreshPlan || tries >= 12) return undefined;
    const id = setTimeout(() => {
      refreshPlan();
      setTries((n) => n + 1);
    }, 2500);
    return () => clearTimeout(id);
  }, [ok, plan, refreshPlan, tries]);

  if (!ok) {
    return (
      <div className="card" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }}>
        <div className="paywall-lock" style={{ color: 'var(--text-2)' }}><Ico icon={CircleX} size={36} /></div>
        <h2 style={{ marginTop: 4 }}>{t('checkout.cancelTitle')}</h2>
        <p className="muted">{t('checkout.cancelText')}</p>
        <div className="row mt16" style={{ justifyContent: 'center' }}>
          <Link to="/pricing" className="btn" style={{ textDecoration: 'none' }}>{t('checkout.backPricing')}</Link>
          <Link to="/" className="btn ghost" style={{ textDecoration: 'none' }}>{t('nav.home')}</Link>
        </div>
      </div>
    );
  }
  const active = plan === 'pro';
  return (
    <div className="card" style={{ maxWidth: 520, margin: '40px auto', textAlign: 'center' }} data-checkout={active ? 'active' : 'pending'}>
      <div className="paywall-lock" style={{ color: active ? 'var(--buy)' : 'var(--text-2)' }}><Ico icon={CircleCheck} size={36} /></div>
      <h2 style={{ marginTop: 4 }}>{active ? t('checkout.successTitle') : t('checkout.activating')}</h2>
      <p className="muted">{active ? t('checkout.successText') : configured && user ? t('checkout.activatingText') : t('checkout.signInText')}</p>
      {!active && tries >= 12 && <p className="muted small">{t('checkout.slow')}</p>}
      <div className="row mt16" style={{ justifyContent: 'center' }}>
        <Link to="/account" className="btn" style={{ textDecoration: 'none' }}>{t('checkout.goAccount')}</Link>
        <Link to="/insiders" className="btn ghost" style={{ textDecoration: 'none' }}>{t('nav.insiders')}</Link>
      </div>
    </div>
  );
}
