import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { useGuruStocks } from '../hooks/useGuruStocks.js';
import { fmtMoney, fmtNum, fmtPct, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useSeo } from '../seo.jsx';
import { consensusSeo } from '../lib/seoTemplates.js';
import AnswerBox from '../components/AnswerBox.jsx';
import Paywall from '../components/Paywall.jsx';
import HoldersPanel from '../components/HoldersPanel.jsx';
import { managerPath } from '../lib/paths.js';
import Ico from '../components/Ico.jsx';
import { Compass, ChevronRight, ChevronDown, Download } from 'lucide-react';

// One page, one table, one question at a time.
//
// The layout is the one a fund investor already reads on a terminal: a strip
// of the four numbers that frame the quarter, the segments of the page as
// tabs, and beneath them a single table with only the columns that answer the
// segment's question. Everything shown comes from the files the site already
// ships — nothing here waits on a build that has not run.
//
// Each segment is its own page — /consensus/bought, /consensus/funds — the way
// the insider signals are /insiders/cluster and /insiders/penny: a URL a reader
// can send, a crawler can index, and a sitemap can list. The chips are links.
const TABS = ['held', 'bought', 'sold', 'new', 'funds', 'universe'];
const pathOf = (k) => (k === 'held' ? '/consensus' : `/consensus/${k}`);
// The split the page has always had: most held is the free hook, the rest of
// the quarter is Pro.
const PRO_TABS = new Set(['bought', 'sold', 'new', 'universe']);
// Segments whose rows are securities with a holder list to open.
const EXPANDABLE = new Set(['held', 'bought', 'sold']);

const Sym = ({ r }) =>
  r.ticker ? (
    <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>
      {r.ticker}
    </Link>
  ) : (
    <span className="muted small">{r.cusip}</span>
  );

// A handful of tickers as links — the fund segment's cells.
function Tickers({ list, cls }) {
  if (!list?.length) return <span className="muted">—</span>;
  return (
    <span className={`small ${cls || ''}`}>
      {list.slice(0, 3).map((p, i) => (
        <span key={p.cusip}>
          {i > 0 && ', '}
          {p.ticker ? <Link to={`/stock/${p.ticker}?cusip=${p.cusip}`}>{p.ticker}</Link> : p.issuer}
          {p.change != null && <span className="muted"> {fmtPct(p.change, { digits: 0 })}</span>}
        </span>
      ))}
      {list.length > 3 && <span className="muted"> +{list.length - 3}</span>}
    </span>
  );
}

function Kpi({ label, value, sub, locked }) {
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div className="small muted">{label}</div>
      {locked ? (
        <div style={{ marginTop: 4 }}>
          <Link to="/pricing" className="badge pro sm">PRO</Link>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
          {sub && <div className="small muted">{sub}</div>}
        </>
      )}
    </div>
  );
}

export default function Consensus() {
  const { t, lang } = useI18n();
  const { isPro } = useAuth();

  const { segment } = useParams();
  const tab = TABS.includes(segment) ? segment : 'held';

  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null); // cusip of the expanded row
  const [exporting, setExporting] = useState(false);

  // The static file is the source. The per-security table, when the daily
  // build has produced it, is the same rows for more names; the page reads
  // identically either way.
  const { data, isLoading, error, proLoading, proError } = useConsensusStatic();
  const table = useGuruStocks({ limit: 500 });
  const seo = useMemo(() => consensusSeo({ lang, data, segment: tab, t }), [lang, data, tab, t]);
  useSeo(seo);

  const uniStocks = useQuery({
    queryKey: ['stocksUniverse'],
    queryFn: api.stocksUniverse,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });

  const { mostHeld = [], topBought = [], topSold = [], newPositions = [], managers = [], updates = [] } = data || {};
  const latest = managers.reduce((m, x) => (x.reportDate > m ? x.reportDate : m), '');

  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const search = (list, fields) =>
      !needle ? list : list.filter((r) => fields.some((f) => String(r[f] || '').toUpperCase().includes(needle)));

    if (tab === 'universe') return search(uniStocks.data?.rows || [], ['ticker', 'issuer']);
    if (tab === 'new') return search(newPositions, ['ticker', 'issuer', 'manager']);
    if (tab === 'funds') {
      // one row per tracked fund, with its quarter-over-quarter card when the
      // build has written one
      const byCik = new Map(updates.map((u) => [u.cik, u]));
      return search(
        managers.map((m) => ({ ...m, ...(byCik.get(m.cik) || {}) })),
        ['name']
      );
    }
    if (table.ready) {
      const base = table.stocks;
      const list =
        tab === 'bought'
          ? base.filter((r) => r.netValue > 0).sort((a, b) => b.netValue - a.netValue)
          : tab === 'sold'
            ? base.filter((r) => r.netValue < 0).sort((a, b) => a.netValue - b.netValue)
            : base;
      return search(list, ['ticker', 'issuer']);
    }
    return search(tab === 'bought' ? topBought : tab === 'sold' ? topSold : mostHeld, ['ticker', 'issuer']);
  }, [tab, q, table.ready, table.stocks, mostHeld, topBought, topSold, newPositions, managers, updates, uniStocks.data]);

  const onExport = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const names = (r) => (r.holders || []).map((h) => h.name).join(', ');
      const sheet = rows.map((r, i) =>
        tab === 'new'
          ? { '#': i + 1, [t('screen.manager')]: r.manager, Ticker: r.ticker || '', [t('table.company')]: r.issuer, [t('table.weight')]: r.weight, [t('table.value')]: Math.round(r.value), [t('screen.quarter')]: quarterLabel(r.reportDate) }
          : tab === 'funds'
            ? { '#': i + 1, [t('screen.manager')]: r.name, [t('screen.quarter')]: quarterLabel(r.reportDate), [t('consensus.h.new')]: (r.newBuys || []).map((p) => p.ticker || p.issuer).join(', '), [t('consensus.h.add')]: (r.adds || []).map((p) => p.ticker || p.issuer).join(', '), [t('consensus.h.reduce')]: (r.reduces || []).map((p) => p.ticker || p.issuer).join(', '), [t('consensus.h.exit')]: (r.exits || []).map((p) => p.ticker || p.issuer).join(', ') }
            : tab === 'universe'
              ? { '#': i + 1, Ticker: r.ticker || '', [t('table.company')]: r.issuer, [t('consensus.funds')]: r.funds, [t('consensus.totalValue')]: Math.round(r.value) }
              : { '#': i + 1, Ticker: r.ticker || '', [t('table.company')]: r.issuer, [t('consensus.funds')]: r.holderCount, [tab === 'held' ? t('consensus.totalValue') : t('consensus.net')]: tab === 'held' ? r.totalValue : r.netValue, [t('consensus.avgWeight')]: r.avgWeight, [t('consensus.heldBy')]: names(r) }
      );
      const ws = XLSX.utils.json_to_sheet(sheet);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Consensus');
      XLSX.writeFile(wb, `fundocap-consensus-${tab}.xlsx`);
    } finally {
      setExporting(false);
    }
  };

  if (isLoading)
    return (
      <div className="loading">
        <div className="spinner" />
        {t('consensus.loading')}
      </div>
    );
  if (error) return <div className="error-box">{t('common.error')}: {String(error.message)}</div>;

  const locked = PRO_TABS.has(tab) && !isPro;
  const expandable = EXPANDABLE.has(tab);
  const toggle = (cusip) => setOpen((cur) => (cur === cusip ? null : cusip));
  const cols = tab === 'new' ? 6 : tab === 'funds' ? 6 : tab === 'universe' ? 5 : 7;
  const topHeld = mostHeld[0];
  const topBuy = topBought[0];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1><Ico icon={Compass} size={22} /> {t('consensus.title')}</h1>
          <div className="sub">{t(`consensus.desc.${tab}`)}</div>
        </div>
      </div>
      <AnswerBox text={seo.answer} />

      {/* ---- the four numbers that frame the quarter — on the front only --- */}
      {tab === 'held' && (
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Kpi label={t('consensus.kpi.funds')} value={fmtNum(managers.length)} sub={<Link to="/gurus">{t('consensus.seeFunds')} →</Link>} />
        <Kpi label={t('consensus.kpi.period')} value={latest ? quarterLabel(latest) : '—'} sub={t('consensus.kpi.periodNote')} />
        <Kpi
          label={t('consensus.kpi.topHeld')}
          value={topHeld ? topHeld.ticker || topHeld.issuer : '—'}
          sub={topHeld ? `${fmtNum(topHeld.holderCount)} ${t('consensus.kpi.fundsHold')}` : null}
        />
        <Kpi
          label={t('consensus.kpi.topBought')}
          locked={!isPro}
          value={topBuy ? topBuy.ticker || topBuy.issuer : '—'}
          sub={topBuy ? `+${fmtMoney(topBuy.netValue)} · ${fmtNum(topBuy.buyers)} ${t('consensus.kpi.fundsBought')}` : null}
        />
      </div>
      )}

      {/* ---- segments ---------------------------------------------------- */}
      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((k) => (
          <Link key={k} to={pathOf(k)} className={`chip${k === tab ? ' fsel-active' : ''}`} aria-current={k === tab ? 'page' : undefined}>
            {t(`consensus.tab.${k}`)}
            {PRO_TABS.has(k) && !isPro && <span className="badge pro sm" style={{ marginLeft: 6 }}>PRO</span>}
          </Link>
        ))}
      </div>

      {locked && <Paywall />}
      {!locked && isPro && proLoading && tab !== 'held' && tab !== 'funds' && (
        <div className="loading"><div className="spinner" />{t('common.loading')}</div>
      )}
      {!locked && isPro && proError && proError.status !== 402 && (
        <div className="error-box">{t('common.error')}: {String(proError.message)}</div>
      )}

      {!locked && (
        <div className="card">
          {/* one search box and the export — nothing else stands between the
              reader and the table */}
          <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              className="search-input sm"
              style={{ flex: '1 1 240px' }}
              placeholder={tab === 'funds' ? t('consensus.searchFund') : t('consensus.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="small muted" style={{ alignSelf: 'center' }}>{fmtNum(rows.length)}</span>
            {isPro && rows.length > 0 && (
              <button className="btn ghost sm" onClick={onExport} disabled={exporting}>
                {exporting ? '…' : <><Ico icon={Download} /> {t('table.export')}</>}
              </button>
            )}
          </div>

          {tab === 'universe' && (
            <p className="muted small" style={{ marginBottom: 10 }}>
              {t('consensus.universeNote')}
              {uniStocks.data?.updatedAt ? ` · ${uniStocks.data.updatedAt.slice(0, 10)}` : ''}
            </p>
          )}
          {tab === 'new' && <p className="muted small" style={{ marginBottom: 10 }}>{t('consensus.newRadarNote')}</p>}
          {tab === 'funds' && <p className="muted small" style={{ marginBottom: 10 }}>{t('consensus.fundsNote')}</p>}

          <div className="table-wrap">
            <table className="data">
              <thead>
                {tab === 'new' ? (
                  <tr>
                    <th className="l">{t('screen.manager')}</th>
                    <th className="l">{t('table.symbol')}</th>
                    <th className="l">{t('table.company')}</th>
                    <th>{t('table.weight')}</th>
                    <th>{t('table.value')}</th>
                    <th>{t('screen.quarter')}</th>
                  </tr>
                ) : tab === 'funds' ? (
                  <tr>
                    <th className="l">{t('screen.manager')}</th>
                    <th className="l">{t('screen.quarter')}</th>
                    <th className="l">{t('consensus.h.new')}</th>
                    <th className="l">{t('consensus.h.add')}</th>
                    <th className="l">{t('consensus.h.reduce')}</th>
                    <th className="l">{t('consensus.h.exit')}</th>
                  </tr>
                ) : tab === 'universe' ? (
                  <tr>
                    <th className="l">#</th>
                    <th className="l">{t('table.symbol')}</th>
                    <th className="l">{t('table.company')}</th>
                    <th>{t('consensus.funds')}</th>
                    <th>{t('consensus.totalValue')}</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="l" style={{ width: 28 }} />
                    <th className="l">{t('table.symbol')}</th>
                    <th className="l">{t('table.company')}</th>
                    <th>{tab === 'held' ? t('consensus.funds') : tab === 'bought' ? t('consensus.buyers') : t('consensus.sellers')}</th>
                    <th>{tab === 'held' ? t('consensus.totalValue') : t('consensus.net')}</th>
                    <th>{t('consensus.avgWeight')}</th>
                    <th className="l">{t('consensus.heldBy')}</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td className="l muted" colSpan={cols}>{t('consensus.noRows')}</td></tr>
                )}

                {tab === 'new' &&
                  rows.map((r, i) => (
                    <tr key={`${r.cik}-${r.cusip}-${i}`}>
                      <td className="l"><Link to={managerPath(r.cik, r.path)}>{r.manager}</Link></td>
                      <td className="l"><Sym r={r} /></td>
                      <td className="l">{r.issuer}</td>
                      <td className="num">{fmtPct(r.weight, { sign: false })}</td>
                      <td className="num">{fmtMoney(r.value)}</td>
                      <td className="num muted">{quarterLabel(r.reportDate)}</td>
                    </tr>
                  ))}

                {tab === 'funds' &&
                  rows.map((m) => (
                    <tr key={m.cik}>
                      <td className="l"><Link to={managerPath(m.cik, m.path)} style={{ fontWeight: 600 }}>{m.name}</Link></td>
                      <td className="l muted small">{m.reportDate ? quarterLabel(m.reportDate) : '—'}</td>
                      <td className="l"><Tickers list={m.newBuys} cls="delta-pos" /></td>
                      <td className="l"><Tickers list={m.adds} cls="delta-pos" /></td>
                      <td className="l"><Tickers list={m.reduces} cls="delta-neg" /></td>
                      <td className="l"><Tickers list={m.exits} cls="delta-neg" /></td>
                    </tr>
                  ))}

                {tab === 'universe' &&
                  rows.map((r, i) => (
                    <tr key={r.cusip}>
                      <td className="l muted">{i + 1}</td>
                      <td className="l"><Sym r={r} /></td>
                      <td className="l">{r.issuer}</td>
                      <td className="num">{fmtNum(r.funds)}</td>
                      <td className="num">{fmtMoney(r.value)}</td>
                    </tr>
                  ))}

                {expandable &&
                  rows.map((r) => {
                    const isOpen = open === r.cusip;
                    const count = tab === 'held' ? r.holderCount : tab === 'bought' ? r.buyers : r.sellers;
                    const main = tab === 'held' ? r.totalValue : r.netValue;
                    return [
                      <tr
                        key={r.cusip}
                        onClick={() => toggle(r.cusip)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggle(r.cusip);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-expanded={isOpen}
                        style={{ cursor: 'pointer' }}
                      >
                        <td className="l muted"><Ico icon={isOpen ? ChevronDown : ChevronRight} size={14} /></td>
                        <td className="l"><Sym r={r} /></td>
                        <td className="l">{r.issuer}</td>
                        <td className="num">{fmtNum(count)}</td>
                        <td className={`num ${tab === 'held' ? '' : main >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                          {tab === 'held' ? fmtMoney(main) : `${main >= 0 ? '+' : '−'}${fmtMoney(Math.abs(main))}`}
                        </td>
                        <td className="num">{r.avgWeight != null ? fmtPct(r.avgWeight, { sign: false }) : '—'}</td>
                        <td className="l small">
                          {(r.holders || []).slice(0, 2).map((h, j) => (
                            <span key={h.cik}>
                              {j > 0 && ', '}
                              {/* the row toggles on click; a fund link must not */}
                              <Link to={managerPath(h.cik, h.path)} onClick={(e) => e.stopPropagation()}>{h.name}</Link>
                            </span>
                          ))}
                          {r.holderCount > 2 && <span className="muted"> +{fmtNum(r.holderCount - 2)}</span>}
                        </td>
                      </tr>,
                      isOpen ? (
                        <HoldersPanel
                          key={`${r.cusip}-panel`}
                          ticker={r.ticker}
                          cusip={r.cusip}
                          holders={r.holders || []}
                          holderCount={r.holderCount}
                          colSpan={cols}
                        />
                      ) : null,
                    ];
                  })}
              </tbody>
            </table>
          </div>

          {expandable && rows.length > 0 && <p className="muted small mt8">{t('consensus.clickHint')}</p>}
        </div>
      )}
    </div>
  );
}
