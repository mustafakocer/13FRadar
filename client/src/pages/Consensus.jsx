import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useConsensusStatic } from '../hooks/useConsensusStatic.js';
import { useGuruStocks, useGuruOptions } from '../hooks/useGuruStocks.js';
import { useStaticReturns } from '../hooks/useStaticReturns.js';
import { fmtMoney, fmtNum, fmtPct, deltaClass, quarterLabel } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';
import { useAuth } from '../auth.jsx';
import { useSeo } from '../seo.jsx';
import { consensusSeo } from '../lib/seoTemplates.js';
import Paywall from '../components/Paywall.jsx';
import HoldersPanel from '../components/HoldersPanel.jsx';
import FilterSelect from '../components/FilterSelect.jsx';
import { managerPath } from '../lib/paths.js';
import Ico from '../components/Ico.jsx';
import { Compass, ChevronRight, ChevronDown, Download } from 'lucide-react';

// Segments live in the URL so /consensus?tab=bought is linkable, exactly as
// the insider feed does it.
const TABS = ['held', 'bought', 'sold', 'new', 'options', 'universe'];
// Everything except the two tabs that are not a per-security table.
const FILTERABLE = new Set(['held', 'bought', 'sold']);
// The split the page has always had: most-held is the free hook, the rest of
// the quarter is Pro. Options stay free because /rankings/options already is,
// and a reader finding the same table paywalled in one place and not the
// other is a bug, not a pricing decision.
const PRO_TABS = new Set(['bought', 'sold', 'new', 'universe']);
const CAPS = ['mega', 'large', 'mid', 'small', 'micro'];
const MIN_FUNDS = ['2', '3', '5', '10'];

const Sym = ({ r }) =>
  r.ticker ? (
    <Link to={`/stock/${r.ticker}?cusip=${r.cusip}`} style={{ fontWeight: 700 }}>
      {r.ticker}
    </Link>
  ) : (
    <span className="muted small">{r.cusip}</span>
  );

export default function Consensus() {
  const { t, lang } = useI18n();
  const { isPro } = useAuth();

  const [sp, setSp] = useSearchParams();
  const tab = TABS.includes(sp.get('tab')) ? sp.get('tab') : 'held';
  const setTab = (k) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (k === 'held') next.delete('tab');
        else next.set('tab', k);
        return next;
      },
      { replace: true }
    );

  const [q, setQ] = useState('');
  const [sector, setSector] = useState('');
  const [cap, setCap] = useState('');
  const [minHolders, setMinHolders] = useState('');
  const [open, setOpen] = useState(null); // cusip of the expanded row
  const [exporting, setExporting] = useState(false);

  // The static file is the free tier and the fallback; the per-security table
  // is what the filters and the whole-universe counts come from.
  const { data, isLoading, error, proLoading, proError } = useConsensusStatic();
  const table = useGuruStocks({ limit: 500, sector, cap, minHolders });
  const optionTable = useGuruOptions();
  const returns = useStaticReturns();
  useSeo(useMemo(() => consensusSeo({ lang, data }), [lang, data]));

  const uniStocks = useQuery({
    queryKey: ['stocksUniverse'],
    queryFn: api.stocksUniverse,
    staleTime: 24 * 60 * 60 * 1000,
    retry: 0,
  });

  const { mostHeld = [], topBought = [], topSold = [], newPositions = [], managers = [] } = data || {};

  // Rows for the active segment. The per-security table wins when the daily
  // build has produced it; otherwise the page falls back to the thirty static
  // rows it has always shown, so a fresh checkout is never blank.
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const search = (list, fields) =>
      !needle
        ? list
        : list.filter((r) => fields.some((f) => String(r[f] || '').toUpperCase().includes(needle)));

    if (tab === 'universe') return search(uniStocks.data?.rows || [], ['ticker', 'issuer']);
    if (tab === 'new') return search(newPositions, ['ticker', 'issuer', 'manager']);
    if (tab === 'options') return search(optionTable.options || [], ['ticker', 'issuer']);

    if (table.ready) {
      const base = table.stocks;
      const filtered =
        tab === 'bought'
          ? base.filter((r) => r.netValue > 0).sort((a, b) => b.netValue - a.netValue)
          : tab === 'sold'
            ? base.filter((r) => r.netValue < 0).sort((a, b) => a.netValue - b.netValue)
            : base;
      return search(filtered, ['ticker', 'issuer']);
    }
    const legacy = tab === 'bought' ? topBought : tab === 'sold' ? topSold : mostHeld;
    return search(legacy, ['ticker', 'issuer']);
  }, [tab, q, table.ready, table.stocks, mostHeld, topBought, topSold, newPositions, optionTable.options, uniStocks.data]);

  const onExport = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const sheet = rows.map((r, i) => {
        if (tab === 'new') {
          return {
            '#': i + 1,
            [t('screen.manager')]: r.manager,
            Ticker: r.ticker || '',
            [t('table.company')]: r.issuer,
            [t('table.weight')]: r.weight,
            [t('table.value')]: Math.round(r.value),
            [t('screen.quarter')]: quarterLabel(r.reportDate),
          };
        }
        if (tab === 'options') {
          return {
            '#': i + 1,
            Ticker: r.ticker || '',
            [t('table.company')]: r.issuer,
            [t('rank.side')]: r.putCall,
            [t('consensus.totalValue')]: r.totalValue,
            [t('consensus.funds')]: r.holderCount,
          };
        }
        if (tab === 'universe') {
          return {
            '#': i + 1,
            Ticker: r.ticker || '',
            [t('table.company')]: r.issuer,
            [t('consensus.funds')]: r.funds,
            [t('consensus.totalValue')]: Math.round(r.value),
          };
        }
        return {
          '#': i + 1,
          Ticker: r.ticker || '',
          [t('table.company')]: r.issuer,
          CUSIP: r.cusip,
          [t('screen.sector')]: r.sector || '',
          [t('consensus.funds')]: r.holderCount,
          [t('consensus.totalValue')]: r.totalValue,
          [t('consensus.avgWeight')]: r.avgWeight,
          [t('stockscreen.topWeight')]: r.maxWeight,
          [t('consensus.net')]: r.netValue,
          // the names are the point of the page, so they travel with the export
          [t('consensus.heldBy')]: (r.holders || []).map((h) => h.name).join(', '),
        };
      });
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
  // Filters on a paywalled segment would narrow a table the reader cannot see.
  const showFilters = FILTERABLE.has(tab) && table.ready && !locked;
  const OPT = (values, prefix) => [
    { v: '', label: t('screen.all') },
    ...values.map((v) => ({ v, label: prefix ? t(`${prefix}.${v}`) : v })),
  ];
  const reset = () => {
    setQ('');
    setSector('');
    setCap('');
    setMinHolders('');
  };

  // Clicking a row opens the funds behind it. Only the per-security segments
  // have a holder list to open.
  const expandable = FILTERABLE.has(tab);
  const toggle = (cusip) => setOpen((cur) => (cur === cusip ? null : cusip));
  // header width of the active segment, so the empty state and the expanded
  // panel span the table instead of a guess
  const cols = tab === 'new' ? 6 : tab === 'options' ? 5 : tab === 'universe' ? 5 : 9;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1><Ico icon={Compass} size={22} /> {t('consensus.title')}</h1>
          <div className="sub">
            {t('consensus.subtitle')}: {fmtNum(table.managers || managers.length)}
            {table.reportDate ? ` · ${quarterLabel(table.reportDate)}` : ''}
            {' · '}
            <Link to="/gurus">{t('consensus.seeFunds')} →</Link>
          </div>
        </div>
      </div>

      {/* ---- segments ---------------------------------------------------- */}
      <div className="row" style={{ gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {TABS.map((k) => (
          <button key={k} className={`chip${k === tab ? ' fsel-active' : ''}`} onClick={() => setTab(k)}>
            {t(`consensus.tab.${k}`)}
            {PRO_TABS.has(k) && !isPro && <span className="badge pro sm" style={{ marginLeft: 6 }}>PRO</span>}
          </button>
        ))}
      </div>

      {/* ---- toolbar ----------------------------------------------------- */}
      <div className="card ins-toolbar">
        <input
          className="search-input sm"
          placeholder={t('consensus.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {showFilters && table.sectors.length > 0 && (
            <FilterSelect label={t('screen.sector')} value={sector} onChange={setSector} options={OPT(table.sectors)} />
          )}
          {showFilters && (
            <>
              <FilterSelect label={t('screen.size')} value={cap} onChange={setCap} options={OPT(CAPS, 'size')} />
              <FilterSelect
                label={t('consensus.minFunds')}
                value={minHolders}
                onChange={setMinHolders}
                options={[{ v: '', label: t('screen.all') }, ...MIN_FUNDS.map((v) => ({ v, label: `${v}+` }))]}
              />
            </>
          )}
          <span className="small muted" style={{ alignSelf: 'center' }}>
            {fmtNum(rows.length)}
            {table.universe && FILTERABLE.has(tab) ? ` / ${fmtNum(table.universe)}` : ''}
          </span>
          {(q || sector || cap || minHolders) && (
            <button className="btn ghost sm" onClick={reset}>{t('screen.reset')}</button>
          )}
          {isPro && !locked && rows.length > 0 && (
            <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={onExport} disabled={exporting}>
              {exporting ? '…' : <><Ico icon={Download} /> {t('table.export')}</>}
            </button>
          )}
        </div>
      </div>

      {locked && <div className="mt16"><Paywall /></div>}
      {!locked && isPro && proLoading && tab !== 'held' && (
        <div className="loading mt16"><div className="spinner" />{t('common.loading')}</div>
      )}
      {!locked && isPro && proError && proError.status !== 402 && (
        <div className="error-box mt16">{t('common.error')}: {String(proError.message)}</div>
      )}

      {!locked && (
        <div className="card mt16">
          {tab === 'universe' && (
            <p className="muted small" style={{ marginBottom: 10 }}>
              {t('consensus.universeNote')}
              {uniStocks.data?.updatedAt ? ` · ${uniStocks.data.updatedAt.slice(0, 10)}` : ''}
            </p>
          )}
          {tab === 'new' && <p className="muted small" style={{ marginBottom: 10 }}>{t('consensus.newRadarNote')}</p>}

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
                ) : tab === 'options' ? (
                  <tr>
                    <th className="l">{t('table.symbol')}</th>
                    <th className="l">{t('table.company')}</th>
                    <th className="l">{t('rank.side')}</th>
                    <th>{t('consensus.totalValue')}</th>
                    <th>{t('consensus.funds')}</th>
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
                    <th className="l">{t('screen.sector')}</th>
                    <th>{t('consensus.funds')}</th>
                    <th>{tab === 'held' ? t('consensus.totalValue') : t('consensus.net')}</th>
                    <th>{t('consensus.avgWeight')}</th>
                    <th>{t('landing.act.ytd')}</th>
                    <th className="l">{t('consensus.heldBy')}</th>
                  </tr>
                )}
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td className="l muted" colSpan={cols}>{t('consensus.noRows')}</td>
                  </tr>
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

                {tab === 'options' &&
                  rows.map((r) => (
                    <tr key={`${r.cusip}-${r.putCall}`}>
                      <td className="l"><Sym r={r} /></td>
                      <td className="l">{r.issuer}</td>
                      <td className="l">
                        <span className={`badge sm ${r.putCall === 'Put' ? 'neg' : 'pos'}`}>{r.putCall}</span>
                      </td>
                      <td className="num">{fmtMoney(r.totalValue)}</td>
                      <td className="num">{fmtNum(r.holderCount)}</td>
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
                    const ret = r.ticker ? (returns.data?.[r.ticker]?.retYtd ?? null) : null;
                    const main = tab === 'held' ? r.totalValue : r.netValue;
                    return [
                      <tr
                        key={r.cusip}
                        onClick={() => toggle(r.cusip)}
                        // the row is the control, so it has to answer the
                        // keyboard too rather than being mouse-only
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
                        <td className="l muted">
                          <Ico icon={isOpen ? ChevronDown : ChevronRight} size={14} />
                        </td>
                        <td className="l"><Sym r={r} /></td>
                        <td className="l">{r.issuer}</td>
                        <td className="l small muted">{r.sector || '—'}</td>
                        <td className="num">{fmtNum(r.holderCount)}</td>
                        <td className={`num ${tab === 'held' ? '' : main >= 0 ? 'delta-pos' : 'delta-neg'}`}>
                          {tab === 'held' ? fmtMoney(main) : `${main >= 0 ? '+' : '−'}${fmtMoney(Math.abs(main))}`}
                        </td>
                        <td className="num">{fmtPct(r.avgWeight, { sign: false })}</td>
                        <td className={`num ${deltaClass(ret)}`}>{ret != null ? fmtPct(ret) : '—'}</td>
                        <td className="l small">
                          {(r.holders || []).slice(0, 2).map((h, j) => (
                            <span key={h.cik}>
                              {j > 0 && ', '}
                              {/* the row toggles on click; a fund link must not */}
                              <Link to={managerPath(h.cik, h.path)} onClick={(e) => e.stopPropagation()}>
                                {h.name}
                              </Link>
                            </span>
                          ))}
                          {r.holderCount > 2 && (
                            <span className="muted"> +{fmtNum(r.holderCount - 2)}</span>
                          )}
                        </td>
                      </tr>,
                      isOpen ? (
                        <HoldersPanel key={`${r.cusip}-panel`} ticker={r.ticker} cusip={r.cusip} colSpan={cols} />
                      ) : null,
                    ];
                  })}
              </tbody>
            </table>
          </div>

          {expandable && rows.length > 0 && (
            <p className="muted small mt8">{t('consensus.clickHint')}</p>
          )}
        </div>
      )}
    </div>
  );
}
