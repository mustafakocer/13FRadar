import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { api } from '../lib/api.js';
import { track, EVENTS } from '../lib/analytics.js';
import { newEventId, metaParams, lead } from '../lib/metaPixel.js';

// One email field for a lead magnet (api/_lib/leads.js has the list):
// 'newsletter', 'report:2026-q2', 'xl-consensus', 'xl-insiders', 'match',
// 'guru:<cik>'. The server mails a confirmation link (double opt-in); the
// magnet arrives after the click. The newsletter tick is separate and starts
// unticked: a download is not a subscription.
// Off until the build has VITE_LEADS_ENABLED=1, which is set once the
// subscribers table exists and the API can send mail (docs/LEAD-MAGNETS.md):
// a form that cannot deliver must not collect addresses.
export const leadsEnabled = () => import.meta.env?.VITE_LEADS_ENABLED === '1';

export default function LeadForm({ magnet, title, text, cta, compact = false, offerNewsletter = true, className = '' }) {
  const { t, lang } = useI18n();
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: people never see it
  const [newsletter, setNewsletter] = useState(false);
  const [state, setState] = useState('idle'); // idle | busy | pending | sent | limited | error | soon
  const kind = String(magnet).split(':')[0];
  const isNewsletter = kind === 'newsletter';
  if (!leadsEnabled()) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (state === 'busy') return;
    setState('busy');
    const eid = newEventId('lead');
    const meta = metaParams(eid);
    try {
      const r = await api.subscribe({ email, magnet, lang, newsletter: isNewsletter || newsletter, website, ...(meta || {}) });
      track(EVENTS.lead, { magnet: kind });
      if (meta) lead(eid, kind);
      setState(r.status === 'sent' || r.status === 'limited' ? r.status : 'pending');
    } catch (err) {
      setState(err.status === 503 ? 'soon' : 'error');
    }
  };

  if (state === 'pending' || state === 'sent' || state === 'limited') {
    // 'limited': the address hit the day's mail cap, so nothing new went out
    return (
      <div className={`card lead-card no-print ${className}`} data-lead={kind} data-lead-state={state} role="status">
        <p className="lead-done">{t(`lead.${state}`)}</p>
        {state !== 'limited' && <p className="muted small">{t('lead.spam')}</p>}
      </div>
    );
  }

  return (
    <form className={`card lead-card no-print${compact ? ' compact' : ''} ${className}`} onSubmit={submit} data-lead={kind}>
      {title && <h3 className="lead-title">{title}</h3>}
      {text && <p className="muted small lead-text">{text}</p>}
      <div className="lead-row">
        <input
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder={t('lead.placeholder')}
          aria-label={t('lead.placeholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="lead-input"
        />
        <button type="submit" className="btn" disabled={state === 'busy'}>{state === 'busy' ? '…' : cta || t('lead.cta')}</button>
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} className="lead-hp" aria-hidden="true" />
      {!isNewsletter && offerNewsletter && (
        <label className="small lead-check">
          <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} /> {t('lead.alsoNewsletter')}
        </label>
      )}
      {state === 'error' && <p className="small delta-neg" role="alert">{t('lead.error')}</p>}
      {state === 'soon' && <p className="small muted" role="alert">{t('lead.soon')}</p>}
      <p className="muted lead-legal">
        {t('lead.legal')} <Link to={lang === 'tr' ? '/gizlilik' : '/privacy'}>{t('consent.more')}</Link>
      </p>
    </form>
  );
}
