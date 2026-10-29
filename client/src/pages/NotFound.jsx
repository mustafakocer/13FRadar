import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';

// The catch-all route. The server already answers an unmatched path with a
// 404 status (api/ssr.js); this is what the reader sees instead of an empty
// main area, with the ways back into the site.
export default function NotFound() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const seo = useMemo(
    () => ({ title: `${t('nf.title')} — Fundocap`, description: '', path: pathname, noindex: true }),
    [t, pathname]
  );
  useSeo(seo);

  return (
    <div className="card" data-not-found style={{ maxWidth: 560, margin: '48px auto', textAlign: 'center' }}>
      <h1>{t('nf.title')}</h1>
      <p className="muted">{t('nf.text')}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <Link to="/" className="btn" style={{ textDecoration: 'none' }}>{t('nf.home')}</Link>
        <Link to="/gurus" className="btn ghost" style={{ textDecoration: 'none' }}>{t('nf.gurus')}</Link>
        <Link to="/insiders" className="btn ghost" style={{ textDecoration: 'none' }}>{t('nf.insiders')}</Link>
      </div>
    </div>
  );
}
