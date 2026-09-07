import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { fmtMoney, fmtPct, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { usePageTitle } from '../hooks/usePageTitle.js';
import Paywall from '../components/Paywall.jsx';

const Sym = ({ r }) =>
  r.ticker ? (
    <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }}>
      {r.ticker}
    </Link>
  ) : (
    <span className="muted small">{r.cusip}</span>
  );

function HoldersCell({ holders }) {
  return (
    <span className="small muted">
      {holders.slice(0, 3).map((h, i) => (
        <span key={h.cik}>
          {i > 0 && ', '}
          <Link to={`/manager/${h.cik}`}>{h.name}</Link>
        </span>
      ))}
      {holders.length > 3 ? ` +${holders.length - 3}` : ''}
    </span>
  );
}

export default function Consensus() {
  const { t } = useI18n();
  const { isPro } = useAuth();
  usePageTitle(`${t('consensus.title')} — 13F Radar`);

  // public part from the static CDN file; buys/sells/new positions come from
  // the Pro-only API and are merged in for Pro users
  const { data, isLoading, error, proLoading, proError } = useConsensusStatic();

  // whole-universe most-held (static file produced by the GitHub Action)
  const uniStocks = useQuery({
    queryKey: ['stocksUniverse'],
    queryFn: api.stocksUniverse,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });

  if (isLoading)
    return (
      <div className="loading">
        <div className="spinner" />
        {t('consensus.loading')}
      </div>
    );
  if (error)
    return <div className="error-box">{t('common.error')}: {String(error.message)}</div>;

  const { mostHeld = [], topBought = [], topSold = [], newPositions = [], managers = [] } = data;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🧭 {t('consensus.title')}</h1>
          <div className="sub">
            {t('consensus.subtitle')} ({managers.length}):{' '}
            {managers.map((m, i) => (
              <span key={m.cik}>
                {i > 0 && ' · '}
                <Link to={`/manager/${m.cik}`}>{m.name}</Link>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>🏆 {t('consensus.mostHeld')}</h3>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">{t('table.symbol')}</th>
                <th className="l">{t('table.company')}</th>
                <th>{t('consensus.funds')}</th>
                <th>{t('consensus.totalValue')}</th>
                <th>{t('consensus.avgWeight')}</th>
                <th className="l">{t('consensus.heldBy')}</th>
              </tr>
            </thead>
            <tbody>
              {mostHeld.map((r) => (
                <tr key={r.cusip}>
                  <td className="l"><Sym r={r} /></td>
                  <td className="l">{r.issuer}</td>
                  <td className="num">{r.holderCount}</td>
                  <td className="num">{fmtMoney(r.totalValue)}</td>
                  <td className="num">{fmtPct(r.avgWeight, { sign: false })}</td>
                  <td className="l"><HoldersCell holders={r.holders} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!isPro && (
        <div className="mt16">
          <Paywall />
        </div>
      )}

      {isPro && proLoading && (
        <div className="loading mt16">
          <div className="spinner" />
          {t('common.loading')}
        </div>
      )}
      {isPro && proError && (
        <div className="mt16">
          {proError.status === 402 ? (
            <Paywall />
          ) : (
            <div className="error-box">{t('common.error')}: {String(proError.message)}</div>
          )}
        </div>
      )}

      {isPro && !proLoading && !proError && (
      <>
      <div className="grid grid-2 mt16">
        {[
          { key: 'topBought', rows: topBought, icon: '📈', field: (r) => fmtMoney(r.netValue), cls: 'delta-pos' },
          { key: 'topSold', rows: topSold, icon: '📉', field: (r) => fmtMoney(r.netValue), cls: 'delta-neg' },
        ].map((sec) => (
          <div className="card" key={sec.key}>
            <h3>{sec.icon} {t(`consensus.${sec.key}`)}</h3>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th className="l">{t('table.symbol')}</th>
                    <th className="l">{t('table.company')}</th>
                    <th>{t('consensus.net')}</th>
                    <th>{t('consensus.funds')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((r) => (
                    <tr key={r.cusip}>
                      <td className="l"><Sym r={r} /></td>
                      <td className="l" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.issuer}</td>
                      <td className={`num ${sec.cls}`}>{sec.field(r)}</td>
                      <td className="num">{sec.key === 'topBought' ? r.buyers : r.sellers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {uniStocks.data?.rows?.length > 0 && (
        <div className="card mt16">
          <h3>🌍 {t('consensus.universeTop')}</h3>
          <p className="muted small" style={{ marginBottom: 10 }}>
            {t('consensus.universeNote')} · {uniStocks.data.updatedAt?.slice(0, 10)}
          </p>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">#</th>
                  <th className="l">{t('table.symbol')}</th>
                  <th className="l">{t('table.company')}</th>
                  <th>{t('consensus.funds')}</th>
                  <th>{t('consensus.totalValue')}</th>
                </tr>
              </thead>
              <tbody>
                {uniStocks.data.rows.slice(0, 50).map((r, i) => (
                  <tr key={r.cusip}>
                    <td className="l muted">{i + 1}</td>
                    <td className="l"><Sym r={r} /></td>
                    <td className="l">{r.issuer}</td>
                    <td className="num">{r.funds}</td>
                    <td className="num">{fmtMoney(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card mt16">
        <h3>🚨 {t('consensus.newRadar')}</h3>
        <p className="muted small" style={{ marginBottom: 10 }}>{t('consensus.newRadarNote')}</p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">{t('screen.manager')}</th>
                <th className="l">{t('table.symbol')}</th>
                <th className="l">{t('table.company')}</th>
                <th>{t('table.weight')}</th>
                <th>{t('table.value')}</th>
                <th>{t('screen.quarter')}</th>
              </tr>
            </thead>
            <tbody>
              {newPositions.map((r, i) => (
                <tr key={`${r.cik}-${r.cusip}-${i}`}>
                  <td className="l"><Link to={`/manager/${r.cik}`}>{r.manager}</Link></td>
                  <td className="l"><Sym r={r} /></td>
                  <td className="l">{r.issuer}</td>
                  <td className="num">{fmtPct(r.weight, { sign: false })}</td>
                  <td className="num">{fmtMoney(r.value)}</td>
                  <td className="num muted">{quarterLabel(r.reportDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
