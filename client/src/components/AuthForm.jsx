import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import Ico from './Ico.jsx';
import { Mail } from 'lucide-react';

// Sign-in / sign-up / magic-link / reset form with readable error messages
// and a clear "check your inbox" state. `next` is where to go after auth.

// Supabase returns terse English errors; map them to something a customer
// can act on. Falls back to a generic message plus the raw text.
function friendlyError(raw, t) {
  const m = String(raw || '').toLowerCase();
  if (/rate limit/.test(m)) return t('account.err.rateLimit');
  if (/invalid login credentials|invalid credentials/.test(m)) return t('account.err.badCredentials');
  if (/already registered|already been registered|already exists/.test(m)) return t('account.err.exists');
  if (/email not confirmed/.test(m)) return t('account.err.notConfirmed');
  if (/password/.test(m) && /(least|short|weak|characters)/.test(m)) return t('account.err.weakPassword');
  if (/invalid email|unable to validate email|valid email/.test(m)) return t('account.err.badEmail');
  if (/signup.*disabled|not allowed/.test(m)) return t('account.err.signupDisabled');
  if (/fetch|network|failed to/.test(m)) return t('account.err.network');
  return `${t('account.err.generic')} (${raw})`;
}

const RESEND_SECONDS = 60;

export default function AuthForm({ next = null, initialMode = 'signup' }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { signInEmail, signInPassword, signUpPassword, resetPassword } = useAuth();

  const [mode, setMode] = useState(initialMode); // signin | signup | magic | reset
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null); // { kind: 'signup'|'magic'|'reset', email }
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const emailOk = /.+@.+\..+/.test(email.trim());
  const pwOk = password.length >= 6;
  const needsPw = mode === 'signin' || mode === 'signup';
  const canSubmit = emailOk && (!needsPw || pwOk) && !busy;

  const switchMode = (m) => {
    setMode(m);
    setError(null);
    setSent(null);
  };

  const done = () => navigate(next || '/account', { replace: true });

  const submit = async (e) => {
    e?.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const addr = email.trim();
    try {
      if (mode === 'signin') {
        const { error: err } = await signInPassword(addr, password);
        if (err) throw err;
        done();
        return;
      }
      if (mode === 'signup') {
        const { data, error: err } = await signUpPassword(addr, password);
        if (err) throw err;
        // With email confirmation on, Supabase answers an existing address
        // with a user that has no identities instead of an error.
        if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError(t('account.err.exists'));
          return;
        }
        if (data?.session) {
          done(); // confirmation disabled → already signed in
          return;
        }
        setSent({ kind: 'signup', email: addr });
        setCooldown(RESEND_SECONDS);
        return;
      }
      if (mode === 'magic') {
        const { error: err } = await signInEmail(addr);
        if (err) throw err;
        setSent({ kind: 'magic', email: addr });
        setCooldown(RESEND_SECONDS);
        return;
      }
      if (mode === 'reset') {
        const { error: err } = await resetPassword(addr);
        if (err) throw err;
        setSent({ kind: 'reset', email: addr });
        setCooldown(RESEND_SECONDS);
      }
    } catch (err) {
      setError(friendlyError(err?.message || err, t));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const addr = sent.email;
      const r =
        sent.kind === 'signup'
          ? await signUpPassword(addr, password)
          : sent.kind === 'magic'
            ? await signInEmail(addr)
            : await resetPassword(addr);
      if (r.error) throw r.error;
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(friendlyError(err?.message || err, t));
    } finally {
      setBusy(false);
    }
  };

  // ---- "check your inbox" state ------------------------------------------
  if (sent) {
    return (
      <div className="card auth-card">
        <div className="auth-success">
          <div className="auth-icon"><Ico icon={Mail} size={36} /></div>
          <h2>{t('account.checkInbox')}</h2>
          <p>
            {t(`account.sent.${sent.kind}`)} <b>{sent.email}</b>
          </p>
          <p className="muted small">{t('account.spamHint')}</p>
          {error && <div className="alert err">{error}</div>}
          <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 6 }}>
            <button className="btn ghost" onClick={resend} disabled={cooldown > 0 || busy}>
              {cooldown > 0
                ? t('account.resendIn').replace('{s}', String(cooldown))
                : t('account.resend')}
            </button>
            <button className="btn ghost" onClick={() => switchMode('signin')}>
              {t('account.backToSignin')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- form ----------------------------------------------------------------
  const forPro = next === '/pricing';
  const subtitle = forPro ? t('account.sub.forPro') : t(`account.sub.${mode}`);

  return (
    <div className="card auth-card">
      <h2 className="auth-title">{t(`account.hdr.${mode}`)}</h2>
      <p className="muted auth-sub">{subtitle}</p>

      {(mode === 'signin' || mode === 'signup') && (
        <div className="tabs" style={{ marginTop: 4 }}>
          {['signin', 'signup'].map((m) => (
            <button
              key={m}
              type="button"
              className={`tab${mode === m ? ' active' : ''}`}
              onClick={() => switchMode(m)}
            >
              {t(`account.mode.${m}`)}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} noValidate>
        <label className="field">
          <span>{t('account.emailLabel')}</span>
          <input
            type="email"
            inputMode="email"
            placeholder="ad@ornek.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus
          />
        </label>

        {needsPw && (
          <label className="field">
            <span>{t('account.pwLabel')}</span>
            <div className="pw-wrap">
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                minLength={6}
              />
              <button
                type="button"
                className="pw-toggle"
                onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? t('account.hide') : t('account.show')}
              >
                {showPw ? t('account.hide') : t('account.show')}
              </button>
            </div>
            {mode === 'signup' && (
              <span className={`hint${password && !pwOk ? ' warn' : ''}`}>{t('account.passwordRule')}</span>
            )}
          </label>
        )}

        {mode === 'magic' && <p className="muted small">{t('account.magicInfo')}</p>}
        {mode === 'reset' && <p className="muted small">{t('account.resetInfo')}</p>}

        {error && (
          <div className="alert err" role="alert">
            {error}
          </div>
        )}

        <button className="btn auth-submit" type="submit" disabled={!canSubmit}>
          {busy
            ? '…'
            : mode === 'signin'
              ? t('account.signIn')
              : mode === 'signup'
                ? forPro
                  ? t('account.createAndContinue')
                  : t('account.signUp')
                : mode === 'magic'
                  ? t('account.sendLink')
                  : t('account.sendReset')}
        </button>
      </form>

      <div className="auth-links">
        {mode === 'signin' && (
          <>
            <button type="button" className="linklike" onClick={() => switchMode('reset')}>
              {t('account.forgot')}
            </button>
            <span>·</span>
            <button type="button" className="linklike" onClick={() => switchMode('magic')}>
              {t('account.mode.magic')}
            </button>
          </>
        )}
        {mode === 'signup' && (
          <span>
            {t('account.haveAccount')}{' '}
            <button type="button" className="linklike" onClick={() => switchMode('signin')}>
              {t('account.signIn')}
            </button>
          </span>
        )}
        {(mode === 'magic' || mode === 'reset') && (
          <button type="button" className="linklike" onClick={() => switchMode('signin')}>
            ← {t('account.backToSignin')}
          </button>
        )}
      </div>
    </div>
  );
}
