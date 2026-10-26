import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { api } from '../lib/api.js';

// The unsubscribe link in every mail lands here (/api/unsubscribe GET
// redirects): one button, because link scanners in mail servers follow every
// link and must not unsubscribe anyone. Mail clients' one-click POST skips
// this page.
export default function Unsubscribe() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const token = params.get('t') || '';
  const [state, setState] = useState('idle'); // idle | busy | done | error
  useSeo({ title: `${t('lead.unsubTitle')} — Fundocap`, description: '', path: '/unsubscribe', noindex: true });

  const go = async () => {
    setState('busy');
    try {
      await api.unsubscribe(token);
      setState('done');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="card lead-page" data-unsubscribe={state}>
      <h1>{t('lead.unsubTitle')}</h1>
      {state === 'done' ? (
        <p>{t('lead.unsubDone')}</p>
      ) : (
        <>
          <p className="muted">{t('lead.unsubText')}</p>
          <button type="button" className="btn" onClick={go} disabled={!token || state === 'busy'}>{state === 'busy' ? '…' : t('lead.unsubCta')}</button>
          {state === 'error' && <p className="small delta-neg">{t('lead.error')}</p>}
        </>
      )}
      <p className="mt16"><Link to="/">{t('nav.home')}</Link></p>
    </div>
  );
}
