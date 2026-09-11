import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtPct, fmtMoney, fmtNum, fmtRatio, fmtFracPct } from '../lib/format.js';
import SearchBox from '../components/SearchBox.jsx';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { useAuth } from '../auth.jsx';
import Paywall from '../components/Paywall.jsx';

const STOCK_ROWS = [
  ['price', 'stock.prevClose', (s) => fmtNum(s.price?.price, 2)],
  ['mktCap', 'stock.mktCap', (s) => fmtMoney(s.price?.marketCap)],
  ['pe', 'stock.trailingPE', (s) => fmtRatio(s.valuation?.trailingPE)],
  ['fpe', 'stock.forwardPE', (s) => fmtRatio(s.valuation?.forwardPE)],
  ['peg', 'stock.peg', (s) => fmtRatio(s.valuation?.peg)],
  ['ps', 'stock.ps', (s) => fmtRatio(s.valuation?.priceToSales)],
  ['pb', 'stock.pb', (s) => fmtRatio(s.valuation?.priceToBook)],
  ['evEbitda', 'stock.evEbitda', (s) => fmtRatio(s.valuation?.evToEbitda)],
  ['revenue', 'stock.revenue', (s) => fmtMoney(s.fundamentals?.revenue)],
  ['revG', 'stock.revenueGrowth', (s) => fmtFracPct(s.fundamentals?.revenueGrowth)],
  ['gm', 'stock.grossMargin', (s) => fmtFracPct(s.fundamentals?.grossMargin)],
  ['pm', 'stock.profitMargin', (s) => fmtFracPct(s.fundamentals?.profitMargin)],
  ['roe', 'stock.roe', (s) => fmtFracPct(s.fundamentals?.roe)],
  ['de', 'stock.debtEquity', (s) => fmtRatio(s.fundamentals?.debtToEquity)],
  ['divY', 'stock.divYield', (s) => fmtFracPct(s.fundamentals?.dividendYield, { digits: 2 })],
  ['beta', 'stock.beta', (s) => fmtRatio(s.trading?.beta)],
];

function StockCompare({ t }) {
  const [input, setInput] = useState('');
  const [tickers, setTickers] = useState([]);

  const add = () => {
    const sym = input.trim().toUpperCase();
    if (sym && !tickers.includes(sym) && tickers.length < 3) setTickers([...tickers, sym]);
    setInput('');
  };

  const queries = useQueries({
    queries: tickers.map((tk) => ({
      queryKey: ['stock', tk],
      queryFn: () => api.stock(tk),
      retry: 1,
    })),
  });

  return (
    <>
      <div className="card">
        <div className="row">
          <input
            className="search-input sm"
            style={{ maxWidth: 220 }}
            placeholder={t('compare.tickerPlaceholder')}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn" onClick={add} disabled={tickers.length >= 3}>
            +
          </button>
          {tickers.map((tk) => (
            <span key={tk} className="badge plain">
              {tk}{' '}
              <button
                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}
                onClick={() => setTickers(tickers.filter((x) => x !== tk))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      </div>
      {tickers.length > 0 && (
        <div className="card mt16">
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l"> </th>
                  {tickers.map((tk, i) => (
                    <th key={tk}>
                      <Link to={`/stock/${tk}`}>{tk}</Link>
                      {queries[i].isLoading ? ' …' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STOCK_ROWS.map(([key, label, fn]) => (
                  <tr key={key}>
                    <td className="l muted">{t(label)}</td>
                    {tickers.map((tk, i) => (
                      <td key={tk} className="num">
                        {queries[i].data ? fn(queries[i].data) : queries[i].error ? '⚠' : '…'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function useLatestHoldings(mgr) {
  const { isPro } = useAuth();
  const info = useQuery({
    queryKey: ['manager', mgr?.cik],
    queryFn: () => api.manager(mgr.cik),
    enabled: !!mgr,
  });
  const filing = info.data?.filings?.[0];
  const holdings = useQuery({
    queryKey: ['holdings', mgr?.cik, filing?.acc, isPro],
    queryFn: () => api.holdings(mgr.cik, filing.acc, isPro ? { full: '1' } : {}),
    enabled: !!filing,
    staleTime: 6 * 60 * 60 * 1000,
  });
  return { info, filing, holdings };
}

function Picker({ label, mgr, setMgr, t }) {
  return (
    <div className="card picker-card">
      {mgr ? (
        <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
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
  const { t, lang } = useI18n();
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Fon ve Hisse Karşılaştırma | 13F Radar' : 'Compare Funds & Stocks | 13F Radar',
        description: lang === 'tr' ? 'İki fonun portföyünü veya üç hissenin rasyolarını yan yana karşılaştırın.' : 'Compare two fund portfolios or three stocks side by side.',
        path: '/compare',
      }),
      [lang]
    )
  );
  const { isPro } = useAuth();
  const [mode, setMode] = useState('managers');
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

      <div className="tabs">
        {['managers', 'stocks'].map((m) => (
          <button key={m} className={`tab${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
            {t(`compare.mode.${m}`)}
          </button>
        ))}
      </div>

      {!isPro ? (
        <Paywall />
      ) : (
        <>
          {mode === 'stocks' && <StockCompare t={t} />}

          {mode === 'managers' && (
            <div className="grid grid-2 picker-row">
              <Picker label={t('compare.selectA')} mgr={a} setMgr={setA} t={t} />
              <Picker label={t('compare.selectB')} mgr={b} setMgr={setB} t={t} />
            </div>
          )}
        </>
      )}

      {mode === 'managers' && loading && (
        <div className="loading">
          <div className="spinner" />
          {t('common.loading')}
        </div>
      )}

      {mode === 'managers' && A.holdings.data && B.holdings.data && (
        <div className="grid grid-3 mt24">
          <List title={`🤝 ${t('compare.common')} (${common.length})`} rows={common} t={t} />
          <List title={`🅰️ ${t('compare.onlyA')} (${onlyA.length})`} rows={onlyA} t={t} />
          <List title={`🅱️ ${t('compare.onlyB')} (${onlyB.length})`} rows={onlyB} t={t} />
        </div>
      )}
    </div>
  );
}
