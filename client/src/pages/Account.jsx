import { useMemo, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAlerts } from '../hooks/useAlerts.js';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { api } from '../lib/api.js';
import AuthForm from '../components/AuthForm.jsx';

export default function Account() {
  const { t, lang } = useI18n();
  const { alerts, emailEnabled, loading: alertsLoading, removeAlert, setEmail } = useAlerts();
  const {
    configured,
    user,
    plan,
    loading,
    signOut,
    refreshPlan,
  } = useAuth();
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
        <AuthForm next={next} initialMode={next === '/pricing' ? 'signup' : 'signin'} />
      </div>
    );
  }

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
            <span className="badge pro">PRO</span>
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
        {plan === 'pro' && (
          <button className="btn ghost" onClick={openPortal} disabled={billingBusy}>
            {billingBusy ? '…' : t('account.manageBilling')}
          </button>
        )}
        <button className="btn ghost" onClick={signOut}>
          {t('account.signOut')}
        </button>
      </div>
      {billingErr && <div className="muted small mt8">{billingErr}</div>}

      <div className="mt16" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <b>{t('alerts.title')}</b>
        <label className="check-row mt8">
          <input type="checkbox" checked={emailEnabled} onChange={(e) => setEmail(e.target.checked)} />
          <span>
            <b>{t('alerts.email')}</b>
            <span className="muted small"> — {t('alerts.emailNote')}</span>
          </span>
        </label>
        {alerts.length > 0 && (
          <table className="data mt8">
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="l">{a.label}</td>
                  <td className="l small muted">{t(`alerts.kind.${a.kind}`)}</td>
                  <td className="num">
                    <button className="btn ghost sm" onClick={() => removeAlert(a.id)}>
                      {t('alerts.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!alerts.length && !alertsLoading && <div className="muted small mt8">{t('alerts.none')}</div>}
      </div>
    </div>
  );
}
