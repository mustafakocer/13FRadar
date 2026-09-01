import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';

export default function Account() {
  const { t } = useI18n();
  const { configured, user, plan, signInEmail, signOut, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);
  usePageTitle(`${t('account.title')} — 13F Radar`);

  if (!configured) {
    return (
      <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
        <h3>{t('account.title')}</h3>
        <p className="muted">{t('account.notConfigured')}</p>
      </div>
    );
  }

  if (loading) return <div className="loading"><div className="spinner" />{t('common.loading')}</div>;

  if (!user) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: '40px auto' }}>
        <h3>{t('account.signIn')}</h3>
        <p className="muted small" style={{ marginBottom: 14 }}>{t('account.magicInfo')}</p>
        {sent ? (
          <div className="badge pos">✉️ {t('account.magicSent')}</div>
        ) : (
          <>
            <input
              className="search-input sm"
              type="email"
              placeholder="ornek@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key !== 'Enter') return;
                const { error } = await signInEmail(email.trim());
                if (error) setErr(error.message);
                else setSent(true);
              }}
            />
            <button
              className="btn mt16"
              onClick={async () => {
                const { error } = await signInEmail(email.trim());
                if (error) setErr(error.message);
                else setSent(true);
              }}
              disabled={!/.+@.+\..+/.test(email)}
            >
              {t('account.sendLink')}
            </button>
            {err && <p className="small" style={{ color: 'var(--neg)', marginTop: 8 }}>{err}</p>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
      <h3>{t('account.title')}</h3>
      <div className="kv"><span className="k">E-posta</span><span className="v">{user.email}</span></div>
      <div className="kv">
        <span className="k">{t('account.plan')}</span>
        <span className="v">
          {plan === 'pro' ? (
            <span className="badge pos">PRO</span>
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
        <button className="btn ghost" onClick={signOut}>
          {t('account.signOut')}
        </button>
      </div>
    </div>
  );
}
