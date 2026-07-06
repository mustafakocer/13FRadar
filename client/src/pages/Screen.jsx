import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtMoney, fmtNum, fmtPct, quarterLabel } from '../lib/format.js';
import { POPULAR_MANAGERS } from '../data/popular.js';
import { useI18n } from '../i18n.jsx';

// Screener. Preferred source: /universe.json (all ~8k 13F filers, generated
// weekly by the GitHub Action). Fallback: curated managers with live fetch.
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

function passes(row, f) {
  if (f.minAum && row.aum / 1e6 < Number(f.minAum)) return false;
  if (f.maxAum && row.aum / 1e9 > Number(f.maxAum)) return false;
  if (f.maxPositions && row.positions > Number(f.maxPositions)) return false;
  if (f.minTop10 && row.top10 < Number(f.minTop10)) return false;
  if (f.name && !row.name.toLowerCase().includes(f.name.toLowerCase())) return false;
  return true;
}

function LiveRow({ cik, name, filters }) {
  const { info, filing, holdings } = useManagerStats(cik);
  const h = holdings.data;
  const top10 = h ? h.positions.slice(0, 10).reduce((s, p) => s + p.weight, 0) : null;
  if (h && !passes({ name: info.data?.name || name, aum: h.aum, positions: h.count, top10 }, filters))
    return null;
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
  const [filters, setFilters] = useState({
    minAum: '',
    maxAum: '',
    maxPositions: '',
    minTop10: '',
    name: '',
  });
  const [shown, setShown] = useState(100);
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const universe = useQuery({
    queryKey: ['universe'],
    queryFn: api.universe,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });

  const uniRows = useMemo(() => {
    if (!universe.data?.rows) return null;
    return universe.data.rows.filter((r) => passes(r, filters));
  }, [universe.data, filters]);

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
          <div className="sub">
            {uniRows
              ? `${t('screen.universeMode')} (${fmtNum(universe.data.count)}) · ${universe.data.updatedAt?.slice(0, 10)}`
              : t('screen.subtitle')}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="row">
          <label className="small muted" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {t('screen.manager')}
            <input className="search-input sm" style={{ width: 200 }} value={filters.name} onChange={set('name')} />
          </label>
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
                <th>{uniRows ? t('manager.filedOn') : t('screen.quarter')}</th>
                <th>AUM</th>
                <th>{t('manager.positions')}</th>
                <th>{t('manager.top10')}</th>
              </tr>
            </thead>
            <tbody>
              {uniRows
                ? uniRows.slice(0, shown).map((r) => (
                    <tr key={r.cik}>
                      <td className="l">
                        <Link to={`/manager/${r.cik}`} style={{ fontWeight: 700 }}>
                          {r.name}
                        </Link>
                      </td>
                      <td className="l muted small">{r.cik.replace(/^0+/, '')}</td>
                      <td className="num muted">{r.filed}</td>
                      <td className="num">{fmtMoney(r.aum)}</td>
                      <td className="num">{fmtNum(r.positions)}</td>
                      <td className="num">{fmtPct(r.top10, { sign: false })}</td>
                    </tr>
                  ))
                : POPULAR_MANAGERS.map((m) => (
                    <LiveRow key={m.cik} cik={m.cik} name={m.name} filters={filters} />
                  ))}
            </tbody>
          </table>
        </div>
        {uniRows && uniRows.length > shown && (
          <button className="btn ghost mt16" onClick={() => setShown((s) => s + 200)}>
            {t('common.all')} ({fmtNum(uniRows.length)})
          </button>
        )}
      </div>
    </div>
  );
}
