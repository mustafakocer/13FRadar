import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { LIMITS } from '../lib/planLimits.js';
import { api } from '../lib/api.js';
import { fmtPct, fmtMoney, fmtNum, fmtRatio, fmtFracPct } from '../lib/format.js';
import SearchBox from '../components/SearchBox.jsx';
import { useI18n } from '../i18n.jsx';
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

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

function Picker({ label, mgr, setMgr, onRemove }) {
  return (
    <div className="card" style={{ flex: '1 1 220px', minWidth: 0 }}>
      {mgr ? (
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <b style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{mgr.name}</b>
          <button className="btn ghost" onClick={onRemove}>
            ✕
          </button>
        </div>
      ) : (
        <SearchBox small placeholder={label} onSelect={setMgr} />
      )}
    </div>
  );
}

function Sym({ r }) {
  return r.ticker ? <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }}>{r.ticker}</Link> : <span className="muted small">{r.cusip}</span>;
}

function Overlap({ ciks, names, t }) {
  const q = useQuery({
    queryKey: ['overlap', [...ciks].sort().join(',')],
    queryFn: () => api.overlap(ciks),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  if (q.isLoading)
    return (
      <div className="loading">
        <div className="spinner" />
        {t('common.loading')}
      </div>
    );
  if (q.error?.status === 402) return <div className="mt16"><Paywall compact /></div>;
  if (q.error) return <div className="error-box mt16">{t('common.error')}: {String(q.error.message)}</div>;
  const d = q.data;
  const letter = Object.fromEntries(ciks.map((c, i) => [c, LETTERS[i]]));
  const label = (cik) => names[cik] || d.funds.find((f) => f.cik === cik)?.name || cik;
  const pct = (x) => fmtPct(x * 100, { sign: false, digits: 0 });

  return (
    <div className="mt16">
      <div className="card">
        <h3>🧮 {t('compare.similarity')}</h3>
        <div className="head-badges" style={{ marginBottom: 12 }}>
          <span className="badge plain">{t('compare.jaccardAll')}: <b>{pct(d.overallJaccard)}</b></span>
          <span className="badge plain">{t('compare.sharedAll')}: <b>{d.sharedAllCount}</b></span>
          <span className="badge plain">{t('compare.sharedAny')}: <b>{d.shared.length}</b></span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">{t('compare.pair')}</th>
                <th>{t('compare.sharedCount')}</th>
                <th>{t('compare.jaccard')}</th>
                <th>{t('compare.weighted')}</th>
              </tr>
            </thead>
            <tbody>
              {d.pairs.map((p) => (
                <tr key={`${p.a}-${p.b}`}>
                  <td className="l">
                    <b>{letter[p.a]}</b> {label(p.a)} × <b>{letter[p.b]}</b> {label(p.b)}
                  </td>
                  <td className="num">{p.shared}</td>
                  <td className="num">{pct(p.jaccard)}</td>
                  <td className="num">{fmtPct(p.weightedOverlap, { sign: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small mt8">{t('compare.methodNote')}</p>
      </div>

      <div className="card mt16">
        <h3>🤝 {t('compare.common')} ({d.shared.length})</h3>
        {!d.shared.length && <div className="muted small">{t('common.na')}</div>}
        {d.shared.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="l">{t('table.symbol')}</th>
                  <th className="l">{t('table.company')}</th>
                  {ciks.map((c) => (
                    <th key={c} title={label(c)}>{letter[c]} %</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.shared.slice(0, 100).map((r) => (
                  <tr key={r.cusip} className={r.all ? 'row-all' : ''}>
                    <td className="l"><Sym r={r} />{r.all && <span className="badge pos" style={{ marginLeft: 6 }}>{t('compare.allBadge')}</span>}</td>
                    <td className="l" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.issuer}</td>
                    {ciks.map((c) => (
                      <td key={c} className="num">{r.weights[c] != null ? fmtPct(r.weights[c], { sign: false, digits: 2 }) : <span className="muted">—</span>}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-2 mt16">
        <div className="card pos-col">
          <h3>🟢 {t('compare.sharedBuys')} ({d.sharedBuys.length})</h3>
          {!d.sharedBuys.length && <div className="muted small">{t('compare.noSharedTrades')}</div>}
          {d.sharedBuys.map((r) => (
            <div className="pos-row" key={r.cusip}>
              <div style={{ minWidth: 0 }}>
                <div className="tick"><Sym r={r} /></div>
                <div className="issuer">{r.issuer}</div>
              </div>
              <div className="right small">
                {r.buys.map((b) => (
                  <span key={b.cik} className="badge pos" style={{ marginLeft: 4 }}>{letter[b.cik]} {t(`timeline.action.${b.action}`)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="card pos-col">
          <h3>🔴 {t('compare.sharedSells')} ({d.sharedSells.length})</h3>
          {!d.sharedSells.length && <div className="muted small">{t('compare.noSharedTrades')}</div>}
          {d.sharedSells.map((r) => (
            <div className="pos-row" key={r.cusip}>
              <div style={{ minWidth: 0 }}>
                <div className="tick"><Sym r={r} /></div>
                <div className="issuer">{r.issuer}</div>
              </div>
              <div className="right small">
                {r.sells.map((b) => (
                  <span key={b.cik} className="badge neg" style={{ marginLeft: 4 }}>{letter[b.cik]} {t(`timeline.action.${b.action}`)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {d.funds.some((f) => !f.hasPrev) && <p className="muted small mt8">{t('compare.noPrevNote')}</p>}

      <div className={`grid grid-${Math.min(3, ciks.length)} mt16`}>
        {ciks.map((c) => (
          <div className="card pos-col" key={c}>
            <h3>{letter[c]} · {t('compare.uniqueTo')} {label(c)} ({(d.unique[c] || []).length})</h3>
            {!(d.unique[c] || []).length && <div className="muted small">{t('common.na')}</div>}
            {(d.unique[c] || []).map((r) => (
              <div className="pos-row" key={r.cusip}>
                <div style={{ minWidth: 0 }}>
                  <div className="tick"><Sym r={r} /></div>
                  <div className="issuer">{r.issuer}</div>
                </div>
                <div className="right"><div className="w">{fmtPct(r.weight, { sign: false })}</div></div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Compare() {
  const { t } = useI18n();
  const { isPro } = useAuth();
  const [mode, setMode] = useState('managers');
  const [funds, setFunds] = useState([null, null]);
  const maxFunds = isPro ? LIMITS.pro.compareFunds : LIMITS.free.compareFunds;

  const setAt = (i, mgr) => setFunds((f) => f.map((x, j) => (j === i ? mgr : x)));
  const removeAt = (i) =>
    setFunds((f) => (f.length > 2 ? f.filter((_, j) => j !== i) : f.map((x, j) => (j === i ? null : x))));
  const chosen = funds.filter(Boolean);
  const ciks = chosen.map((m) => m.cik);
  const names = Object.fromEntries(chosen.map((m) => [m.cik, m.name]));

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

      {mode === 'stocks' && (isPro ? <StockCompare t={t} /> : <Paywall />)}

      {mode === 'managers' && (
        <>
          <div className="row" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
            {funds.map((m, i) => (
              <Picker
                key={i}
                label={t('compare.selectN', { n: LETTERS[i] })}
                mgr={m}
                setMgr={(x) => setAt(i, x)}
                onRemove={() => removeAt(i)}
              />
            ))}
            {funds.length < maxFunds && (
              <button className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => setFunds((f) => [...f, null])}>
                + {t('compare.addFund')}
              </button>
            )}
            {!isPro && funds.length >= maxFunds && (
              <span className="muted small" style={{ alignSelf: 'center' }}>
                {t('compare.proMore', { n: LIMITS.pro.compareFunds })} <Link to="/pricing">{t('paywall.cta')}</Link>
              </span>
            )}
          </div>
          {ciks.length >= 2 && <Overlap ciks={ciks} names={names} t={t} />}
        </>
      )}
    </div>
  );
}
