import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtPct } from '../lib/format.js';
import SearchBox from '../components/SearchBox.jsx';
import { useI18n } from '../i18n.jsx';

function useLatestHoldings(mgr) {
  const info = useQuery({
    queryKey: ['manager', mgr?.cik],
    queryFn: () => api.manager(mgr.cik),
    enabled: !!mgr,
  });
  const filing = info.data?.filings?.[0];
  const holdings = useQuery({
    queryKey: ['holdings', mgr?.cik, filing?.acc],
    queryFn: () => api.holdings(mgr.cik, filing.acc, { fd: filing.filingDate, rd: filing.reportDate }),
    enabled: !!filing,
    staleTime: 6 * 60 * 60 * 1000,
  });
  return { info, filing, holdings };
}

function Picker({ label, mgr, setMgr, t }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 260 }}>
      {mgr ? (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b>{mgr.name}</b>
          <button className="btn ghost" onClick={() => setMgr(null)}>
            ✕
          </button>
        </div>
      ) : (
        <SearchBox small placeholder={label} onSelect={setMgr} />
      )}
    </div>
  );
}

function List({ title, rows, t }) {
  return (
    <div className="card pos-col">
      <h3>{title}</h3>
      {!rows.length && <div className="muted small">{t('common.na')}</div>}
      {rows.slice(0, 25).map((r) => (
        <div className="pos-row" key={r.key}>
          <div style={{ minWidth: 0 }}>
            <div className="tick">
              {r.ticker ? <Link to={`/stock/${r.ticker}`}>{r.ticker}</Link> : r.cusip}
            </div>
            <div className="issuer">{r.issuer}</div>
          </div>
          <div className="right">
            {r.wA != null && <div className="w">A: {fmtPct(r.wA, { sign: false })}</div>}
            {r.wB != null && <div className="w">B: {fmtPct(r.wB, { sign: false })}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Compare() {
  const { t } = useI18n();
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const A = useLatestHoldings(a);
  const B = useLatestHoldings(b);

  let common = [];
  let onlyA = [];
  let onlyB = [];
  if (A.holdings.data && B.holdings.data) {
    const mapB = new Map(B.holdings.data.positions.map((p) => [p.cusip, p]));
    const seen = new Set();
    for (const p of A.holdings.data.positions) {
      const q = mapB.get(p.cusip);
      const row = { key: p.cusip, ticker: p.ticker || q?.ticker, issuer: p.issuer, cusip: p.cusip };
      if (q) {
        common.push({ ...row, wA: p.weight, wB: q.weight });
        seen.add(p.cusip);
      } else {
        onlyA.push({ ...row, wA: p.weight });
      }
    }
    onlyB = B.holdings.data.positions
      .filter((p) => !seen.has(p.cusip) && !A.holdings.data.positions.some((x) => x.cusip === p.cusip))
      .map((p) => ({ key: p.cusip, ticker: p.ticker, issuer: p.issuer, cusip: p.cusip, wB: p.weight }));
    common.sort((x, y) => y.wA + y.wB - (x.wA + x.wB));
  }

  const loading = (a && !A.holdings.data && !A.holdings.error) || (b && !B.holdings.data && !B.holdings.error);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t('compare.title')}</h1>
          <div className="sub">{t('compare.subtitle')}</div>
        </div>
      </div>
      <div className="row" style={{ alignItems: 'stretch' }}>
        <Picker label={t('compare.selectA')} mgr={a} setMgr={setA} t={t} />
        <Picker label={t('compare.selectB')} mgr={b} setMgr={setB} t={t} />
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          {t('common.loading')}
        </div>
      )}

      {A.holdings.data && B.holdings.data && (
        <div className="grid grid-3 mt24">
          <List title={`🤝 ${t('compare.common')} (${common.length})`} rows={common} t={t} />
          <List title={`🅰️ ${t('compare.onlyA')} (${onlyA.length})`} rows={onlyA} t={t} />
          <List title={`🅱️ ${t('compare.onlyB')} (${onlyB.length})`} rows={onlyB} t={t} />
        </div>
      )}
    </div>
  );
}
