import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { readConsent, setConsent, onConsentReopen } from '../lib/consent.js';
import { tagsConfigured, routeChanged } from '../lib/tags.js';

// The cookie question and the page views of the consent-gated tags (Meta
// Pixel, GA4, Clarity — lib/tags.js). Renders nothing on the server and on
// the first client render (hydration must match), and nothing at all in a
// build with none of them configured. Accept and Reject
// carry the same weight; the footer's "Cookie preferences" reopens it.
export default function ConsentBanner() {
  const { t, lang } = useI18n();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!tagsConfigured()) return undefined;
    const s = readConsent();
    setState(s);
    if (!s) setOpen(true);
    return onConsentReopen(() => setOpen(true));
  }, []);

  // one page view per route, once allowed (SPA navigation)
  useEffect(() => {
    if (state === 'granted') routeChanged();
  }, [state, pathname]);

  if (!open) return null;
  const choose = (s) => {
    setConsent(s);
    setState(s);
    setOpen(false);
  };
  return (
    <div className="consent-banner no-print" role="dialog" aria-live="polite" aria-label={t('consent.title')} data-consent-banner>
      <p>
        <b>{t('consent.title')}</b> {t('consent.text')}{' '}
        <Link to={lang === 'tr' ? '/gizlilik' : '/privacy'}>{t('consent.more')}</Link>
      </p>
      <div className="consent-actions">
        <button type="button" className="btn ghost sm" onClick={() => choose('denied')} data-consent="denied">{t('consent.reject')}</button>
        <button type="button" className="btn ghost sm" onClick={() => choose('granted')} data-consent="granted">{t('consent.accept')}</button>
      </div>
    </div>
  );
}
