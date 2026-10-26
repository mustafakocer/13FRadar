import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { saveGrant } from '../lib/leadGrant.js';

// Where the confirmation link lands (/api/subscribe-confirm → /thanks?m=&g=):
// the magnets the reader asked for, with their download links. The same
// links are in the welcome mail, valid 30 days.
export default function LeadThanks() {
  const { t, lang } = useI18n();
  const [params] = useSearchParams();
  const grant = params.get('g');
  const expired = params.get('e') === 'expired';
  const magnets = (params.get('m') || '').split(',').filter(Boolean);
  useSeo({ title: `${t('lead.thanksTitle')} — Fundocap`, description: '', path: '/thanks', noindex: true });
  useEffect(() => {
    if (grant) saveGrant(grant);
  }, [grant]);

  if (expired) {
    return (
      <div className="card lead-page" data-lead-thanks="expired">
        <h1>{t('lead.expiredTitle')}</h1>
        <p className="muted">{t('lead.expiredText')}</p>
        <Link to="/" className="btn" style={{ textDecoration: 'none' }}>{t('nav.home')}</Link>
      </div>
    );
  }

  const file = (f) => `/api/lead-file?${new URLSearchParams({ f, l: lang, g: grant || '' })}`;
  const item = (m) => {
    const kind = m.split(':')[0];
    if (kind === 'report') return <a className="btn" href={file(m)} download>📄 {t('lead.m.report')}</a>;
    if (kind === 'xl-consensus') return <a className="btn" href={file(m)} download>📊 {t('lead.m.xl-consensus')}</a>;
    if (kind === 'xl-insiders') return <a className="btn" href={file(m)} download>📊 {t('lead.m.xl-insiders')}</a>;
    if (kind === 'match') return <Link className="btn" to={`/match?g=${encodeURIComponent(grant || '')}`} style={{ textDecoration: 'none' }}>🎯 {t('lead.m.match')}</Link>;
    if (kind === 'newsletter') return <p>📬 {t('lead.m.newsletter')}</p>;
    if (kind === 'guru') return <p>🔔 {t('lead.m.guru')}</p>;
    return null;
  };

  return (
    <div className="card lead-page" data-lead-thanks="ok">
      <h1>🎉 {t('lead.thanksTitle')}</h1>
      <p className="muted">{t('lead.thanksText')}</p>
      <div className="lead-items">{magnets.map((m) => <div key={m}>{item(m)}</div>)}</div>
      <hr />
      <p className="small">{t('lead.upsell')}</p>
      <Link to="/pricing" className="btn ghost" style={{ textDecoration: 'none' }}>{t('paywall.cta')}</Link>
    </div>
  );
}
