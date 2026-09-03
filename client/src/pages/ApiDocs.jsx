import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';

const ENDPOINTS = [
  ['GET /api/v1/datasets', 'apidocs.e.datasets'],
  ['GET /api/v1/manager/{cik}', 'apidocs.e.manager'],
  ['GET /api/v1/holdings/{cik}?acc=', 'apidocs.e.holdings'],
  ['GET /api/v1/position-history/{cik}/{cusip}', 'apidocs.e.history'],
  ['GET /api/v1/overlap?ciks=a,b[,c,d,e]', 'apidocs.e.overlap'],
];

export default function ApiDocs() {
  const { t } = useI18n();
  usePageTitle(`${t('apidocs.title')} — 13F Radar`);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🔌 {t('apidocs.title')}</h1>
          <div className="sub">{t('apidocs.subtitle')}</div>
        </div>
      </div>
      <div className="card">
        <h3>{t('apidocs.auth')}</h3>
        <p className="small">{t('apidocs.authDesc')} <Link to="/account">{t('nav.account')}</Link></p>
        <pre className="small" style={{ overflowX: 'auto', background: 'var(--surface-2)', padding: 12, borderRadius: 8 }}>{`curl -H "X-API-Key: 13fr_…" ${origin}/api/v1/holdings/0001067983`}</pre>
        <p className="muted small">{t('apidocs.limits')}</p>
      </div>
      <div className="card mt16">
        <h3>{t('apidocs.endpoints')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th className="l">Endpoint</th><th className="l">{t('apidocs.returns')}</th></tr></thead>
            <tbody>
              {ENDPOINTS.map(([e, k]) => (
                <tr key={e}><td className="l"><code>{e}</code></td><td className="l">{t(k)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small mt8">{t('apidocs.datasetsNote')}</p>
      </div>
    </div>
  );
}
