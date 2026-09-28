import { useMemo, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useFavorites } from '../hooks/useFavorites.js';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { api } from '../lib/api.js';
import AuthForm from '../components/AuthForm.jsx';

const longDate = (iso, lang) =>
  iso ? new Date(iso).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }) : null;

export default function Account() {
  const { t, lang } = useI18n();
  // kept mounted as before: the watchlist hook syncs the list after sign-in
  useFavorites();
  const { configured, user, plan, profile, loading, signOut, refreshPlan } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const justPaid = params.get('checkout') === 'success';
  // ?next=/pricing — come back to the page that asked for sign-in
  const next = params.get('next') && params.get('next').startsWith('/') ? params.get('next') : null;
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingErr, setBillingErr] = useState(null);
  useSeo(
    useMemo(
      () => ({
        title: `${t('account.title')} — Fundocap`,
        description: '',
        path: '/account',
        noindex: true,
      }),
      [lang, t]
    )
  );

  // Signed in (e.g. via emailed link) with a pending destination → go there.
  useEffect(() => {
    if (user && next && !justPaid) navigate(next, { replace: true });
  }, [user, next, justPaid, navigate]);

  // Back from Stripe: the webhook flips the plan within seconds — poll a few times.
  useEffect(() => {
    if (!justPaid || plan === 'pro' || !refreshPlan) return undefined;
    let n = 0;
    const id = setInterval(() => {
      n++;
      refreshPlan();
      if (n >= 10) clearInterval(id);
    }, 3000);
    return () => clearInterval(id);
  }, [justPaid, plan, refreshPlan]);

  const openPortal = async () => {
    setBillingBusy(true);
    setBillingErr(null);
    try {
      const { url } = await api.portal();
      window.location.assign(url);
    } catch (e) {
      setBillingErr(e.status === 404 ? t('account.noSubscription') : t('account.billingError'));
      setBillingBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
        <h3>{t('account.title')}</h3>
        <p className="muted">{t('account.notConfigured')}</p>
      </div>
    );
  }

  if (loading)
    return (
      <div className="loading">
        <div className="spinner" />
        {t('common.loading')}
      </div>
    );

  if (!user) {
    return (
      <div style={{ maxWidth: 440, margin: '32px auto' }}>
        <AuthForm next={next} initialMode={next?.startsWith('/pricing') ? 'signup' : 'signin'} />
      </div>
    );
  }

  // The Stripe portal is for Stripe customers. A Pro account with no
  // subscription id is a manual or open-ended grant: nothing to manage there.
  const hasSubscription = Boolean(profile?.stripe_subscription_id);
  const enterprise = plan === 'pro' && !hasSubscription;
  const expires = plan === 'pro' ? longDate(profile?.plan_expires, lang) : null;

  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
      <h3>{t('account.title')}</h3>
      {justPaid && plan !== 'pro' && (
        <div className="badge info" style={{ marginBottom: 12 }}>{t('account.paymentReceived')}</div>
      )}
      <div className="kv">
        <span className="k">{t('account.email')}</span>
        <span className="v">{user.email}</span>
      </div>
      <div className="kv">
        <span className="k">{t('account.plan')}</span>
        <span className="v">
          {plan === 'pro' ? (
            <>
              <span className="badge pro">PRO</span>
              {enterprise && <span className="badge plain" style={{ marginLeft: 6 }}>{t('account.enterprise')}</span>}
              {expires && <span className="muted small" style={{ marginLeft: 8 }}>{t('account.expires').replace('{d}', expires)}</span>}
            </>
          ) : (
            <span className="badge plain">{t('pricing.free').toUpperCase()}</span>
          )}
        </span>
      </div>
      <div className="row mt16">
        {plan !== 'pro' && (
          <Link to="/pricing" className="btn" style={{ textDecoration: 'none' }}>
            {t('paywall.cta')}
          </Link>
        )}
        {hasSubscription && (
          <button className="btn ghost" onClick={openPortal} disabled={billingBusy}>
            {billingBusy ? '…' : t('account.manageBilling')}
          </button>
        )}
        <button className="btn ghost" onClick={signOut}>
          {t('account.signOut')}
        </button>
      </div>
      {billingErr && <div className="muted small mt8">{billingErr}</div>}

    </div>
  );
}
