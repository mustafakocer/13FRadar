import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import GoogleButton from './GoogleButton.jsx';
import Ico from './Ico.jsx';
import { X, Star } from 'lucide-react';

// The dialog a signed-out reader gets when they star a fund: sign in with
// Google or by email (the fund is added once they are back), or keep it on
// this device only.
export default function LoginPrompt({ open, onClose, next = '/watchlist', mgr = null, onLocal = null }) {
  const { t } = useI18n();
  if (!open) return null;
  const to = `/account?next=${encodeURIComponent(next)}`;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" data-login-prompt>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}><Ico icon={Star} /> {t('login.title')}</h3>
          <button className="btn ghost" onClick={onClose} aria-label={t('common.close')}><Ico icon={X} /></button>
        </div>
        <p className="muted small mt8">{mgr?.name ? t('login.subFund').replace('{name}', mgr.name) : t('login.sub')}</p>
        <div className="mt16" style={{ display: 'grid', gap: 8 }}>
          <GoogleButton next={next} />
          <Link to={to} className="btn ghost" style={{ textDecoration: 'none', textAlign: 'center' }}>{t('login.email')}</Link>
          {onLocal && (
            <button className="linklike" style={{ marginTop: 6 }} onClick={onLocal}>{t('login.later')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
