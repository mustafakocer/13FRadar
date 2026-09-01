import { useI18n } from '../i18n.jsx';

export default function Footer() {
  const { t } = useI18n();
  return (
    <footer className="site-footer no-print">
      <div className="footer-brand">
        📡 13F<span className="dot">Radar</span>
      </div>
      <p className="muted small">{t('footer.disclaimer')}</p>
      <p className="muted small">{t('footer.sources')}</p>
      <p className="muted small">© {new Date().getFullYear()} 13F Radar</p>
    </footer>
  );
}
