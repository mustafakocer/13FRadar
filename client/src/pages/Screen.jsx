import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, quarterLabel } from '../lib/format.js';
import { POPULAR_MANAGERS } from '../data/popular.js';
import { useI18n } from '../i18n.jsx';

// Screener over the curated manager universe. Row metrics load lazily
// (manager -> latest filing -> light holdings) and filters apply client-side.
function useManagerStats(cik) {
  const info = useQuery({
    queryKey: ['manager', cik],
    queryFn: () => api.manager(cik),
    staleTime: 6 * 60 * 60 * 1000,
  });
  const filing = info.data?.filings?.[0];
  const holdings = useQuery({
    queryKey: ['holdings-light', cik, filing?.acc],
    queryFn: () => api.holdings(cik, filing.acc, { fd: filing.filingDate, light: '1' }),
    enabled: !!filing,
    staleTime: 6 * 60 * 60 * 1000,
  });
  return { info, filing, holdings };
}

function RowStats({ cik, name, filters, t }) {
  const { info, filing, holdings } = useManagerStats(cik);
  const h = holdings.data;
  const top10 = h ? h.positions.slice(0, 10).reduce((s, p) => s + p.weight, 0) : null;

  if (h) {
    const aumM = h.aum / 1e6;
    if (filters.minAum && aumM < Number(filters.minAum)) return null;
    if (filters.maxAum && h.aum / 1e9 > Number(filters.maxAum)) return null;
    if (filters.maxPositions && h.count > Number(filters.maxPositions)) return null;
    if (filters.minTop10 && top10 < Number(filters.minTop10)) return null;
  }

  return (
    <tr>
      <td className="l">
        <Link to={`/manager/${cik}`} style={{ fontWeight: 700 }}>
          {info.data?.name || name}
        </Link>
      </td>
      <td className="l muted small">{cik.replace(/^0+/, '')}</td>
      <td>{filing ? quarterLabel(filing.reportDate) : '…'}</td>
      <td className="num">{h ? fmtMoney(h.aum) : holdings.isError ? '—' : '…'}</td>
      <td className="num">{h ? fmtNum(h.count) : '…'}</td>
      <td className="num">{top10 != null ? fmtPct(top10, { sign: false }) : '…'}</td>
    </tr>
  );
}

export default function Screen() {
  const { t } = useI18n();
  const [filters, setFilters] = useState({ minAum: '', maxAum: '', maxPositions: '', minTop10: '' });
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const fields = [
    ['minAum', 'screen.minAum'],
    ['maxAum', 'screen.maxAum'],
    ['maxPositions', 'screen.maxPositions'],
    ['minTop10', 'screen.minTop10'],
  ];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('screen.title')}</h1>
          <div className="sub">{t('screen.subtitle')}</div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          {fields.map(([k, label]) => (
            <label key={k} className="small muted" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {t(label)}
              <input
                className="search-input sm"
                style={{ width: 130 }}
                type="number"
                value={filters[k]}
                onChange={set(k)}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="card mt16">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">{t('screen.manager')}</th>
                <th className="l">CIK</th>
                <th>{t('screen.quarter')}</th>
                <th>AUM</th>
                <th>{t('manager.positions')}</th>
                <th>{t('manager.top10')}</th>
              </tr>
            </thead>
            <tbody>
              {POPULAR_MANAGERS.map((m) => (
                <RowStats key={m.cik} cik={m.cik} name={m.name} filters={filters} t={t} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
