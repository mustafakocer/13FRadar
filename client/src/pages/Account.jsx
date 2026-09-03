import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import AlertSettings from '../components/AlertSettings.jsx';

export default function Account() {
  const { t } = useI18n();
  const {
    configured,
    user,
    plan,
    loading,
    signInEmail,
    signInPassword,
    signUpPassword,
    resetPassword,
    signOut,
  } = useAuth();
  const [mode, setMode] = useState('signin'); // signin | signup | magic
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null); // {type:'ok'|'err', text}
  const [busy, setBusy] = useState(false);
  usePageTitle(`${t('account.title')} — 13F Radar`);

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
    const emailOk = /.+@.+\..+/.test(email);
    const run = async (fn, okText) => {
      setBusy(true);
      setMsg(null);
      const { error } = await fn();
      setBusy(false);
      if (error) setMsg({ type: 'err', text: error.message });
      else if (okText) setMsg({ type: 'ok', text: okText });
    };

    return (
      <div className="card" style={{ maxWidth: 480, margin: '40px auto' }}>
        <div className="tabs" style={{ marginTop: 0 }}>
          {['signin', 'signup', 'magic'].map((m) => (
            <button
              key={m}
              className={`tab${mode === m ? ' active' : ''}`}
              onClick={() => {
                setMode(m);
                setMsg(null);
              }}
            >
              {t(`account.mode.${m}`)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            className="search-input sm"
            type="email"
            placeholder="ornek@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          {mode !== 'magic' && (
            <input
              className="search-input sm"
              type="password"
              placeholder={t('account.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !emailOk || password.length < 6) return;
                if (mode === 'signin') run(() => signInPassword(email.trim(), password));
                if (mode === 'signup')
                  run(() => signUpPassword(email.trim(), password), t('account.signupSent'));
              }}
            />
          )}

          {mode === 'signin' && (
            <>
              <button
                className="btn"
                disabled={!emailOk || password.length < 6 || busy}
                onClick={() => run(() => signInPassword(email.trim(), password))}
              >
                {busy ? '…' : t('account.signIn')}
              </button>
              <button
                className="btn ghost"
                disabled={!emailOk || busy}
                onClick={() => run(() => resetPassword(email.trim()), t('account.resetSent'))}
              >
                {t('account.forgot')}
              </button>
            </>
          )}

          {mode === 'signup' && (
            <>
              <p className="muted small">{t('account.passwordRule')}</p>
              <button
                className="btn"
                disabled={!emailOk || password.length < 6 || busy}
                onClick={() =>
                  run(() => signUpPassword(email.trim(), password), t('account.signupSent'))
                }
              >
                {busy ? '…' : t('account.signUp')}
              </button>
            </>
          )}

          {mode === 'magic' && (
            <>
              <p className="muted small">{t('account.magicInfo')}</p>
              <button
                className="btn"
                disabled={!emailOk || busy}
                onClick={() => run(() => signInEmail(email.trim()), t('account.magicSent'))}
              >
                {busy ? '…' : t('account.sendLink')}
              </button>
            </>
          )}

          {msg && (
            <div className={`badge ${msg.type === 'ok' ? 'pos' : 'neg'}`} style={{ alignSelf: 'flex-start' }}>
              {msg.text}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="card" style={{ maxWidth: 560, margin: '40px auto' }}>
      <h3>{t('account.title')}</h3>
      <div className="kv">
        <span className="k">E-posta</span>
        <span className="v">{user.email}</span>
      </div>
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
    <AlertSettings />
    </>
  );
}
