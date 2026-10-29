import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { TICKERISH, matchStocks } from '../lib/stockMatch.js';

// Debounced EDGAR manager search with a results dropdown.
// onSelect(manager) — manager: {cik, name}
// onSelectStock(ticker) — optional; when given, tickers and issuer names from
// the stock universe are offered above the managers and Enter on a
// ticker-shaped query opens that stock.
export default function SearchBox({ onSelect, onSelectStock = null, placeholder, small = false, autoFocus = false, initialText = '' }) {
  const { t } = useI18n();
  const [text, setText] = useState(initialText);
  const [q, setQ] = useState(initialText.trim());
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q.length >= 2,
  });

  const { data: universe } = useQuery({
    queryKey: ['stocks-universe'],
    queryFn: api.stocksUniverse,
    enabled: Boolean(onSelectStock) && q.length >= 1,
    staleTime: Infinity,
  });

  const results = data?.results || [];
  const stocks = onSelectStock ? matchStocks(universe?.rows, q) : [];
  // a ticker the universe does not hold (small caps) still gets a direct jump
  // (only when nothing in the universe matched and the query is short enough
  // to be a symbol, so "Buffett" or "Apple" never turns into a fake ticker)
  const directTicker = onSelectStock && !stocks.length && q.length <= 5 && TICKERISH.test(q) ? q.toUpperCase() : null;

  // tracked superinvestors first, then stocks, then the rest of EDGAR
  const tracked = results.filter((r) => r.guru);
  const others = results.filter((r) => !r.guru);
  const managerItem = (r) => (
    <button
      key={r.cik}
      className="search-result-item"
      onClick={() => {
        setOpen(false);
        setText('');
        onSelect(r);
      }}
    >
      <span>{r.name}</span>
      <span className="cik">{r.guru ? t('search.tracked') : r.filings ? `${r.filings} ${t('search.filings')}` : ''}</span>
    </button>
  );

  const pickStock = (ticker) => {
    setOpen(false);
    setText('');
    onSelectStock(ticker);
  };

  return (
    <div className={`search-wrap${small ? ' inline' : ''}`} ref={wrapRef}>
      <input
        className={`search-input${small ? ' sm' : ''}`}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder || t('search.placeholder')}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !onSelectStock) return;
          // read the live text, not the debounced query: Enter right after
          // typing "AAPL" must not act on "AA"
          const cur = text.trim().toUpperCase();
          const hits = matchStocks(universe?.rows, cur);
          if (hits[0]?.ticker === cur) pickStock(cur);
          else if (!hits.length && cur.length <= 5 && TICKERISH.test(cur) && !results.length) pickStock(cur);
        }}
      />
      {open && (q.length >= 2 || stocks.length > 0) && (
        <div className="search-results">
          {tracked.map(managerItem)}
          {stocks.map((s) => (
            <button key={`stk-${s.ticker}`} className="search-result-item" onClick={() => pickStock(s.ticker)}>
              <span>
                <b>{s.ticker}</b> {s.issuer}
              </span>
              <span className="cik">{t('search.stock')}</span>
            </button>
          ))}
          {isFetching && <div className="search-result-item muted">{t('common.loading')}</div>}
          {!isFetching && q.length >= 2 && !results.length && !stocks.length && !directTicker && (
            <div className="search-result-item muted">{t('search.noResults')}</div>
          )}
          {others.map(managerItem)}
          {directTicker && (
            <button className="search-result-item" onClick={() => pickStock(directTicker)}>
              <span>
                {t('palette.goStock')} <b>{directTicker}</b>
              </span>
              <span className="cik">{t('search.stock')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
