import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueries } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtPct, fmtMoney, fmtNum, fmtRatio, fmtFracPct, fmtTurnover, deltaClass } from '../lib/format.js';
import { compareBooks, sectorPairs } from '../lib/compareMetrics.js';
import { sectorSlices } from '../lib/sectorSlices.js';
import { dataset, webPage } from '../lib/jsonld.js';
import { managerPath } from '../lib/paths.js';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import SearchBox from '../components/SearchBox.jsx';
import ProGate from '../components/ProGate.jsx';
import InfoTip from '../components/InfoTip.jsx';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { useAuth } from '../auth.jsx';
import Ico from '../components/Ico.jsx';
import { X, TriangleAlert, Handshake, Plus } from 'lucide-react';

// The comparison a signed-out reader sees, and the one the server renders:
// two curated value funds with a known overlap, and three large caps on the
// stock tab. Picking one's own is Pro.
export const SAMPLE = {
  a: { cik: '0001067983', name: 'Berkshire Hathaway (Warren Buffett)' },
  b: { cik: '0001709323', name: 'Himalaya Capital (Li Lu)' },
};
export const SAMPLE_TICKERS = ['AAPL', 'MSFT', 'GOOGL'];
const LIST_CUT = 8;
const SIX_HOURS = 6 * 60 * 60 * 1000;

const STOCK_ROWS = [
  ['price', 'stock.prevClose', ({ stock: s }) => fmtNum(s?.price?.price, 2)],
  ['mktCap', 'stock.mktCap', ({ stock: s }) => fmtMoney(s?.price?.marketCap)],
  ['pe', 'stock.trailingPE', ({ stock: s }) => fmtRatio(s?.valuation?.trailingPE)],
  ['fpe', 'stock.forwardPE', ({ stock: s }) => fmtRatio(s?.valuation?.forwardPE)],
  ['peg', 'stock.peg', ({ stock: s }) => fmtRatio(s?.valuation?.peg)],
  ['ps', 'stock.ps', ({ stock: s }) => fmtRatio(s?.valuation?.priceToSales)],
  ['pb', 'stock.pb', ({ stock: s }) => fmtRatio(s?.valuation?.priceToBook)],
  ['evEbitda', 'stock.evEbitda', ({ stock: s }) => fmtRatio(s?.valuation?.evToEbitda)],
  ['revenue', 'stock.revenue', ({ stock: s }) => fmtMoney(s?.fundamentals?.revenue)],
  ['revG', 'stock.revenueGrowth', ({ stock: s }) => fmtFracPct(s?.fundamentals?.revenueGrowth)],
  ['gm', 'stock.grossMargin', ({ stock: s }) => fmtFracPct(s?.fundamentals?.grossMargin)],
  ['pm', 'stock.profitMargin', ({ stock: s }) => fmtFracPct(s?.fundamentals?.profitMargin)],
  ['roe', 'stock.roe', ({ stock: s }) => fmtFracPct(s?.fundamentals?.roe)],
  ['de', 'stock.debtEquity', ({ stock: s }) => fmtRatio(s?.fundamentals?.debtToEquity)],
  ['divY', 'stock.divYield', ({ stock: s }) => fmtFracPct(s?.fundamentals?.dividendYield, { digits: 2 })],
  ['beta', 'stock.beta', ({ stock: s }) => fmtRatio(s?.trading?.beta)],
];
// What the curated funds make of the name, and how the price did — the rows
// a 13F site can add that a quote page cannot.
const GURU_ROWS = [
  ['gurus', 'compare.guruCount', ({ guru: g }) => (g?.stock ? fmtNum(g.stock.holderCount) : g?.available ? '0' : '—')],
  ['guruValue', 'compare.guruValue', ({ guru: g }) => (g?.stock ? fmtMoney(g.stock.totalValue) : '—')],
  ['netBuy', 'compare.netBuy', ({ guru: g }) => (g?.stock ? <b className={deltaClass(g.stock.netValue)}>{fmtMoney(g.stock.netValue)}</b> : '—')],
  ['sector', 'compare.sector', ({ guru: g, stock: s }) => g?.stock?.sector || s?.profile?.sector || '—'],
  ['ret1y', 'compare.ret1y', ({ ret: r }) => (r?.ret1y != null ? <b className={deltaClass(r.ret1y)}>{fmtPct(r.ret1y)}</b> : '—')],
  ['retYtd', 'compare.retYtd', ({ ret: r }) => (r?.retYtd != null ? <b className={deltaClass(r.retYtd)}>{fmtPct(r.retYtd)}</b> : '—')],
];

function StockCompare({ t, isPro }) {
  const [input, setInput] = useState('');
  const [tickers, setTickers] = useState(isPro ? [] : SAMPLE_TICKERS);
  const returns = useStaticReturns();

  const add = () => {
    const sym = input.trim().toUpperCase();
    if (sym && !tickers.includes(sym) && tickers.length < 3) setTickers([...tickers, sym]);
    setInput('');
  };

  const stocks = useQueries({
    queries: tickers.map((tk) => ({ queryKey: ['stock', tk], queryFn: () => api.stock(tk), retry: 1 })),
  });
  const gurus = useQueries({
    queries: tickers.map((tk) => ({ queryKey: ['guru-stock', tk], queryFn: () => api.guruStock({ ticker: tk }), retry: 1, staleTime: SIX_HOURS })),
  });
  const cell = (i) => ({ stock: stocks[i].data, guru: gurus[i].data, ret: returns.data?.[tickers[i]] });

  return (
    <>
      {isPro ? (
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
            <button className="btn ghost" onClick={add} disabled={tickers.length >= 3} aria-label={t('compare.tickerPlaceholder')}>
              <Ico icon={Plus} />
            </button>
            {tickers.map((tk) => (
              <span key={tk} className="badge plain">
                {tk}{' '}
                <button
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}
                  onClick={() => setTickers(tickers.filter((x) => x !== tk))}
                  aria-label={t('common.close')}
                >
                  <Ico icon={X} size={14} />
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="card row" style={{ gap: 8 }}>
          <span className="badge info">{t('compare.sample')}</span>
          {tickers.map((tk) => <span key={tk} className="badge plain">{tk}</span>)}
        </div>
      )}
      {tickers.length > 0 && (
        <div className="card mt16">
          <div className="table-wrap">
            <table className="data" data-compare="stocks">
              <thead>
                <tr>
                  <th className="l"> </th>
                  {tickers.map((tk, i) => (
                    <th key={tk}>
                      <Link to={`/stock/${tk}`}>{tk}</Link>
                      {stocks[i].isLoading ? ' …' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GURU_ROWS.map(([key, label, fn]) => (
                  <tr key={key}>
                    <td className="l muted">{t(label)}</td>
                    {tickers.map((tk, i) => (
                      <td key={tk} className="num">{fn(cell(i))}</td>
                    ))}
                  </tr>
                ))}
                {STOCK_ROWS.map(([key, label, fn]) => (
                  <tr key={key}>
                    <td className="l muted">{t(label)}</td>
                    {tickers.map((tk, i) => (
                      <td key={tk} className="num">
                        {stocks[i].data ? fn(cell(i)) : stocks[i].error ? <Ico icon={TriangleAlert} /> : '…'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <ProGate note={t('compare.ownPro')} />
    </>
  );
}

// One side of the comparison: the manager's filing list, the latest
// quarter's book, the previous quarter (for the direction arrows), the
// turnover figure and the sectors of its largest names. `status` is what
// the page shows for that side — 'idle' (nothing picked), 'loading',
// 'empty' (a filer with no 13F), 'error' (a request failed; `error` says
// which) or 'ready'. The query keys are the guru page's, so a fund the
// reader just looked at is already in the cache.
function useSide(mgr) {
  const { isPro } = useAuth();
  const cik = mgr?.cik;
  const info = useQuery({ queryKey: ['manager', cik], queryFn: () => api.manager(cik), enabled: !!mgr });
  const filing = info.data?.filings?.[0];
  const prevFiling = info.data?.filings?.[1];
  const holdings = useQuery({
    queryKey: ['holdings', cik, filing?.acc, isPro],
    queryFn: () => api.holdings(cik, filing.acc, isPro ? { full: '1' } : {}),
    enabled: !!filing,
    staleTime: SIX_HOURS,
  });
  const positions = holdings.data?.positions || [];
  const visibleCusips = positions.slice(0, 10).map((p) => p.cusip);
  const prev = useQuery({
    queryKey: ['holdings-light', cik, prevFiling?.acc, isPro, isPro ? '' : visibleCusips.join(',')],
    queryFn: () => api.holdings(cik, prevFiling.acc, isPro ? { light: '1', full: '1' } : { light: '1', cusips: visibleCusips.join(',') }),
    enabled: !!prevFiling && (isPro || visibleCusips.length > 0),
    staleTime: SIX_HOURS,
    retry: 0,
  });
  const stats = useQuery({ queryKey: ['mstats', cik], queryFn: () => api.managerStats(cik), enabled: !!cik, staleTime: SIX_HOURS, retry: 0 });
  const tickers = positions.slice(0, 25).map((p) => p.ticker).filter(Boolean);
  const sectors = useQuery({
    queryKey: ['sectors', tickers.join(',')],
    queryFn: () => api.sectors(tickers),
    enabled: tickers.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });
  let status = 'idle';
  if (mgr) {
    if (info.error || holdings.error) status = 'error';
    else if (holdings.data) status = 'ready';
    else if (info.data && !filing) status = 'empty';
    else status = 'loading';
  }
  const error = info.error || holdings.error || null;
  const retry = () => (info.error ? info.refetch() : holdings.refetch());
  return { info, filing, holdings, prev, stats, sectors, status, error, retry, isPro };
}

// What went wrong on one side, with a way to try that side again — a failed
// request used to leave the page blank under the two pickers.
function SideStatus({ side, mgr, t }) {
  if (side.status === 'empty') {
    return (
      <div className="muted small">
        <b>{mgr.name}</b>: {t('compare.noFilings')}
      </div>
    );
  }
  if (side.status !== 'error') return null;
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span className="muted small">
        <Ico icon={TriangleAlert} /> <b>{mgr.name}</b>: {t('compare.loadFailed')} ({String(side.error?.message || side.error)})
      </span>
      <button className="btn ghost" onClick={side.retry} disabled={side.info.isFetching || side.holdings.isFetching}>
        {t('common.retry')}
      </button>
    </div>
  );
}

function Picker({ label, mgr, setMgr, t, fixed }) {
  return (
    <div className="card picker-card">
      {mgr ? (
        <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
          <b>
            <Link to={managerPath(mgr.cik)}>{mgr.name}</Link>
          </b>
          {fixed ? (
            <span className="badge info">{t('compare.sample')}</span>
          ) : (
            <button className="btn ghost" onClick={() => setMgr(null)} aria-label={t('common.close')}>
              <Ico icon={X} />
            </button>
          )}
        </div>
      ) : (
        <SearchBox small placeholder={label} onSelect={setMgr} />
      )}
    </div>
  );
}

const DIR = { new: '★', up: '▲', down: '▼', flat: '=' };
function Dir({ d, t }) {
  if (!d) return <span className="muted">—</span>;
  return (
    <span className={`dir-${d}`} title={t(`compare.dir.${d}`)}>
      {DIR[d]} <span className="small">{t(`compare.dir.${d}`)}</span>
    </span>
  );
}

function Metric({ label, tip, value, ab }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="k">
        {label}
        {tip && <InfoTip tip={tip} />}
      </div>
      <div className="v">{value}</div>
      {ab && <div className="ab">{ab}</div>}
    </div>
  );
}

function List({ title, rows, t, side }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, LIST_CUT);
  return (
    <div className="card pos-col">
      <h3>{title}</h3>
      {!rows.length && <div className="muted small">{t('common.na')}</div>}
      {shown.map((r) => (
        <div className="pos-row" key={r.key}>
          <div style={{ minWidth: 0 }}>
            <div className="tick">{r.ticker ? <Link to={`/stock/${r.ticker}`}>{r.ticker}</Link> : r.cusip}</div>
            <div className="issuer">{r.issuer}</div>
          </div>
          <div className="right">
            <div className="w">{fmtPct(side === 'A' ? r.wA : r.wB, { sign: false })}</div>
          </div>
        </div>
      ))}
      {rows.length > LIST_CUT && (
        <button className="btn ghost sm mt8" onClick={() => setAll((v) => !v)}>
          {all ? t('compare.showLess') : t('compare.showAll').replace('{n}', rows.length)}
        </button>
      )}
    </div>
  );
}

function SectorBars({ pairs, t }) {
  if (!pairs.length) return null;
  const max = Math.max(...pairs.map((p) => Math.max(p.a, p.b)), 1);
  return (
    <div className="card mt16">
      <h3>{t('compare.sectorMix')}</h3>
      <div className="cmp-sectors" data-compare="sectors">
        <div className="cmp-sector muted small">
          <div style={{ textAlign: 'right' }}>A</div>
          <div />
          <div>B</div>
        </div>
        {pairs.map((p) => (
          <div className="cmp-sector" key={p.name}>
            <div className="bar a">
              <span>{p.a ? fmtPct(p.a, { sign: false, digits: 0 }) : ''}</span>
              <i style={{ width: `${(p.a / max) * 100}%` }} />
            </div>
            <div className="name" title={p.name}>{p.unclassified ? t('sector.unclassified') : p.name}</div>
            <div className="bar b">
              <i style={{ width: `${(p.b / max) * 100}%` }} />
              <span>{p.b ? fmtPct(p.b, { sign: false, digits: 0 }) : ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Compare() {
  const { t, lang } = useI18n();
  const { isPro } = useAuth();
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Fon ve Hisse Karşılaştırma | Fundocap' : 'Compare Funds & Stocks | Fundocap',
        description:
          lang === 'tr'
            ? 'İki fonun 13F portföyünü örtüşme, ağırlık farkı ve sektör dağılımıyla, ya da üç hissenin rasyolarını ve usta sahipliğini yan yana karşılaştırın.'
            : 'Compare two 13F portfolios by overlap, weight difference and sector mix, or three stocks by ratios and guru ownership, side by side.',
        path: '/compare',
        jsonLd: [
          webPage({ name: lang === 'tr' ? 'Fon ve Hisse Karşılaştırma' : 'Compare Funds & Stocks', lang, path: '/compare' }),
          dataset({
            name: lang === 'tr' ? '13F portföy karşılaştırması' : '13F portfolio comparison',
            description:
              lang === 'tr'
                ? 'İki kurumsal yatırımcının SEC 13F bildirimlerinden türetilen portföy karşılaştırması: ortak pozisyonlar, Jaccard ve ağırlıklı örtüşme, sektör dağılımı ve son çeyrek yönü.'
                : 'A portfolio comparison derived from two institutional investors’ SEC 13F filings: common positions, Jaccard and weighted overlap, sector mix and last-quarter direction.',
            lang,
            path: '/compare',
            keywords: ['13F', 'portfolio overlap', 'SEC EDGAR', 'Berkshire Hathaway', 'Himalaya Capital'],
          }),
        ],
      }),
      [lang]
    )
  );
  const [mode, setMode] = useState('managers');
  const [a, setA] = useState(isPro ? null : SAMPLE.a);
  const [b, setB] = useState(isPro ? null : SAMPLE.b);
  const A = useSide(a);
  const B = useSide(b);

  const books = useMemo(() => {
    if (!A.holdings.data || !B.holdings.data) return null;
    return compareBooks(A.holdings.data, B.holdings.data, {
      prevA: A.prev.data || null,
      prevB: B.prev.data || null,
      prevComplete: isPro,
    });
  }, [A.holdings.data, B.holdings.data, A.prev.data, B.prev.data, isPro]);

  const pairs = useMemo(() => {
    if (!books) return [];
    const mixA = sectorSlices((A.holdings.data?.positions || []).slice(0, 25), A.sectors.data || {}, { unclassified: '__unclassified' }).data;
    const mixB = sectorSlices((B.holdings.data?.positions || []).slice(0, 25), B.sectors.data || {}, { unclassified: '__unclassified' }).data;
    return sectorPairs(mixA, mixB);
  }, [books, A.holdings.data, B.holdings.data, A.sectors.data, B.sectors.data]);

  const loading = A.status === 'loading' || B.status === 'loading';
  const problem = (a && A.status !== 'loading' && A.status !== 'ready') || (b && B.status !== 'loading' && B.status !== 'ready');
  const ab = (x, y) => `A ${x} · B ${y}`;

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

      {mode === 'stocks' && <StockCompare t={t} isPro={isPro} />}

      {mode === 'managers' && (
        <div className="grid grid-2 picker-row">
          <Picker label={t('compare.selectA')} mgr={a} setMgr={setA} t={t} fixed={!isPro} />
          <Picker label={t('compare.selectB')} mgr={b} setMgr={setB} t={t} fixed={!isPro} />
        </div>
      )}

      {mode === 'managers' && loading && (
        <div className="loading">
          <div className="spinner" />
          {t('common.loading')}
        </div>
      )}

      {mode === 'managers' && problem && (
        <div className="card mt16" style={{ display: 'grid', gap: 8 }}>
          {a && <SideStatus side={A} mgr={a} t={t} />}
          {b && <SideStatus side={B} mgr={b} t={t} />}
        </div>
      )}

      {mode === 'managers' && books && (
        <>
          <div className="cmp-strip mt16" data-compare="strip">
            <Metric label={t('compare.overlap')} tip="compare.overlapTip" value={fmtPct(books.jaccard, { sign: false, digits: 0 })} ab={`${books.common.length} / ${books.countA + books.countB - books.common.length}`} />
            <Metric label={t('compare.weightedOverlap')} tip="compare.weightedOverlapTip" value={fmtPct(books.weightedOverlap, { sign: false, digits: 0 })} />
            <Metric label={t('compare.size')} value={ab(fmtMoney(books.sizeA), fmtMoney(books.sizeB))} />
            <Metric label={t('compare.positions')} value={ab(fmtNum(books.countA), fmtNum(books.countB))} />
            <Metric label={t('compare.top10')} value={ab(fmtPct(books.top10A, { sign: false, digits: 0 }), fmtPct(books.top10B, { sign: false, digits: 0 }))} />
            <Metric label={t('compare.turnover')} value={ab(fmtTurnover(A.stats.data?.turnoverLatest), fmtTurnover(B.stats.data?.turnoverLatest))} />
          </div>
          {!isPro && <p className="muted small mt8">{t('compare.freeBasis')}</p>}

          <div className="card mt16">
            <h3><Ico icon={Handshake} /> {t('compare.common')} ({books.common.length})</h3>
            {!books.common.length && <div className="muted small">{t('common.na')}</div>}
            {books.common.length > 0 && (
              <div className="table-wrap">
                <table className="data" data-compare="common">
                  <thead>
                    <tr>
                      <th className="l">{t('table.symbol')}</th>
                      <th>A %</th>
                      <th>B %</th>
                      <th>{t('compare.delta')}</th>
                      <th className="l">{t('compare.lastQuarter')} A</th>
                      <th className="l">{t('compare.lastQuarter')} B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {books.common.map((r) => (
                      <tr key={r.key}>
                        <td className="l">
                          <b>{r.ticker ? <Link to={`/stock/${r.ticker}`}>{r.ticker}</Link> : r.cusip}</b>
                          <div className="muted small">{r.issuer}</div>
                        </td>
                        <td className="num">{fmtPct(r.wA, { sign: false })}</td>
                        <td className="num">{fmtPct(r.wB, { sign: false })}</td>
                        <td className={`num ${deltaClass(r.delta)}`}>{fmtPct(r.delta, { digits: 1 })}</td>
                        <td className="l"><Dir d={r.dirA} t={t} /></td>
                        <td className="l"><Dir d={r.dirB} t={t} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <SectorBars pairs={pairs} t={t} />

          <div className="grid grid-2 mt16">
            <List title={`🅰️ ${t('compare.onlyA')} (${books.onlyA.length})`} rows={books.onlyA} t={t} side="A" />
            <List title={`🅱️ ${t('compare.onlyB')} (${books.onlyB.length})`} rows={books.onlyB} t={t} side="B" />
          </div>
          <ProGate note={t('compare.ownPro')} />
        </>
      )}
    </div>
  );
}
