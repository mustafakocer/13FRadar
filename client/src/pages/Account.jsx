import { useMemo, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAlerts } from '../hooks/useAlerts.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { api } from '../lib/api.js';
import { managerPath } from '../lib/paths.js';
import AuthForm from '../components/AuthForm.jsx';

export default function Account() {
  const { t, lang } = useI18n();
  const { alerts, emailDigest, frequency, prefsLoaded, loading: alertsLoading, error: alertsError, removeAlert, setEmail, setPrefs, enableFilingAlerts } = useAlerts();
  const { favorites } = useFavorites();
  const { configured, user, plan, loading, signOut, refreshPlan } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const justPaid = params.get('checkout') === 'success';
  // ?next=/pricing — come back to the page that asked for sign-in
  const next = params.get('next') && params.get('next').startsWith('/') ? params.get('next') : null;
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingErr, setBillingErr] = useState(null);
  const [enabling, setEnabling] = useState(null);
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

  // funds on the watchlist that have no filing alert yet — one click turns one on
  const alerted = new Set(alerts.filter((a) => a.kind === 'filing').map((a) => a.target));
  const pending = favorites.filter((f) => !alerted.has(String(f.cik).padStart(10, '0')));
  const enable = async (funds, key) => {
    setEnabling(key);
    await enableFilingAlerts(funds);
    setEnabling(null);
  };

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
          <input type="checkbox" checked={emailDigest} disabled={!prefsLoaded} onChange={(e) => setEmail(e.target.checked)} />
          <span>
            <b>{t('alerts.email')}</b>
            <span className="muted small"> — {t('alerts.emailNote')}</span>
          </span>
        </label>
        {emailDigest && (
          <label className="row mt8" style={{ gap: 8, alignItems: 'center' }}>
            <span className="small muted">{t('alerts.frequency')}</span>
            <select className="select" value={frequency} onChange={(e) => setPrefs({ digest_frequency: e.target.value })}>
              <option value="daily">{t('alerts.daily')}</option>
              <option value="weekly">{t('alerts.weekly')}</option>
            </select>
          </label>
        )}
        {alerts.length > 0 && (
          <table className="data mt8">
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id}>
                  <td className="l">
                    {a.kind === 'filing' ? (
                      <Link to={managerPath(a.target)}>{a.label || a.target}</Link>
                    ) : (
                      <>{a.label || a.target}</>
                    )}
                  </td>
                  <td className="l small muted">{t(`alerts.kind.${a.kind}`)}{a.kind === 'insider' && a.target !== '*' ? ` · ${a.target}` : ''}</td>
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
        {!alertsLoading && pending.length > 0 && (
          <div className="mt8">
            <div className="small muted">{alerts.length ? t('alerts.enableMore') : t('alerts.enableIntro')}</div>
            <div className="row mt8" style={{ gap: 6, flexWrap: 'wrap' }}>
              {pending.slice(0, 12).map((f) => (
                <button key={f.cik} className="chip" disabled={enabling != null} onClick={() => enable([f], f.cik)}>
                  {enabling === f.cik ? '…' : `${t('alerts.enableFor')} ${f.name}`}
                </button>
              ))}
              {pending.length > 1 && (
                <button className="btn ghost sm" disabled={enabling != null} onClick={() => enable(pending, 'all')}>
                  {enabling === 'all' ? '…' : t('alerts.enableAll').replace('{n}', pending.length)}
                </button>
              )}
            </div>
          </div>
        )}
        {!alertsLoading && !alerts.length && !pending.length && (
          <div className="muted small mt8">
            {t('alerts.noneWatch')} <Link to="/gurus">{t('nav.gurus')} →</Link>
          </div>
        )}
        {alertsError && (
          <div className="muted small mt8" style={{ color: 'var(--neg)' }}>
            {alertsError.code === 'cap' ? (
              <>
                {t('alerts.capReached')} {plan !== 'pro' && <Link to="/pricing">{t('paywall.cta')}</Link>}
              </>
            ) : (
              alertsError.message
            )}
          </div>
        )}
      </div>
    </div>
  );
}
