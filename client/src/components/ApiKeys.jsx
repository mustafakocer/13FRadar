import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { flagOn } from '../lib/flags.js';

// Account page section: read-only API keys (Pro).
export default function ApiKeys() {
  const { t } = useI18n();
  const { isPro } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.keys.list(), enabled: isPro, retry: false });
  const create = useMutation({ mutationFn: () => api.keys.create(name.trim() || 'API key'), onSuccess: (d) => { setFresh(d.key); setName(''); qc.invalidateQueries({ queryKey: ['api-keys'] }); } });
  const revoke = useMutation({ mutationFn: (id) => api.keys.revoke(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }) });
  if (!flagOn('exportApi')) return null;
  return (
    <div className="card" style={{ maxWidth: 560, margin: '16px auto 0' }}>
      <h3>🔑 {t('apikeys.title')}</h3>
      <p className="muted small">{t('apikeys.desc')} <Link to="/api-docs">{t('apikeys.docs')}</Link></p>
      {!isPro && <p className="muted small">{t('apikeys.proOnly')} <Link to="/pricing">{t('paywall.cta')}</Link></p>}
      {isPro && (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input className="search-input sm" style={{ maxWidth: 220 }} placeholder={t('apikeys.name')} value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn" onClick={() => create.mutate()} disabled={create.isPending}>{t('apikeys.create')}</button>
            {create.error && <span className="muted small">{String(create.error.message)}</span>}
          </div>
          {fresh && (
            <div className="mt8" style={{ padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>
              <div className="small"><b>{t('apikeys.showOnce')}</b></div>
              <code style={{ wordBreak: 'break-all' }}>{fresh}</code>
            </div>
          )}
          {(keys.data?.items || []).map((k) => (
            <div className="kv" key={k.id}>
              <span className="k">
                <b>{k.name}</b> <code>{k.prefix}…</code>
                <span className="muted small"> · {k.created_at?.slice(0, 10)}{k.last_used_at ? ` · ${t('apikeys.lastUsed')} ${k.last_used_at.slice(0, 10)}` : ''}{k.revoked_at ? ` · ${t('apikeys.revoked')}` : ''}</span>
              </span>
              {!k.revoked_at && <button className="btn ghost" onClick={() => revoke.mutate(k.id)} disabled={revoke.isPending}>{t('apikeys.revoke')}</button>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
