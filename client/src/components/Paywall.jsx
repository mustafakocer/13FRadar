import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import Ico from './Ico.jsx';
import { Lock } from 'lucide-react';

// Wrap premium features: renders children for Pro users, a lock card otherwise.
export default function Paywall({ children = null, compact = false, secondary = false }) {
  const { isPro } = useAuth();
  const { t } = useI18n();
  if (isPro) return children;
  return (
    <div className="card paywall" style={compact ? { padding: 14 } : {}}>
      <div className="paywall-lock"><Ico icon={Lock} size={28} /></div>
      <h3>{t('paywall.title')}</h3>
      <p className="muted small">{t('paywall.desc')}</p>
      <Link to="/pricing" className={secondary ? 'btn ghost' : 'btn'} style={{ textDecoration: 'none' }}>
        {t('paywall.cta')}
      </Link>
    </div>
  );
}
