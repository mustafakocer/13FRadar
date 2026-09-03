import { useI18n } from '../i18n.jsx';

// SPK (Capital Markets Board of Türkiye) notice. Rendered once in the app
// layout so every page — including printed reports — carries it.
export default function SpkNotice() {
  const { t } = useI18n();
  return (
    <p className="spk-notice muted small" role="note">
      {t('legal.spk')}
    </p>
  );
}
