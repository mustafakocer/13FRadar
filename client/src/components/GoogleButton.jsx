import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';

// "Continue with Google": starts the OAuth round trip through Supabase and
// lands back on /account with `next` preserved (lib/authRedirect.js).
export default function GoogleButton({ next = null, className = 'btn auth-google', onError = null }) {
  const { signInGoogle } = useAuth();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try {
      const { error } = (await signInGoogle(next)) || {};
      if (error) throw error;
      // the browser is leaving for Google; nothing else to do
    } catch (e) {
      setBusy(false);
      if (onError) onError(e);
    }
  };
  return (
    <button type="button" className={className} onClick={click} disabled={busy} data-auth="google">
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17z" />
        <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.5 0 20.1 0 24s1 7.5 2.6 10.7l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
      {busy ? '…' : t('account.google')}
    </button>
  );
}
