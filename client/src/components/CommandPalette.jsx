import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { POPULAR_MANAGERS } from '../data/popular.js';
import { useI18n } from '../i18n.jsx';
import { managerPath } from '../lib/paths.js';
import { TICKERISH, matchStocks } from '../lib/stockMatch.js';
import Ico from './Ico.jsx';
import { ChartCandlestick, Landmark } from 'lucide-react';

// Global ⌘K / Ctrl+K quick-search: managers via EDGAR + direct ticker jump.
export default function CommandPalette() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setText('');
      setQ('');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: open && q.length >= 2,
  });
  const { data: universe } = useQuery({
    queryKey: ['stocks-universe'],
    queryFn: api.stocksUniverse,
    enabled: open && q.length >= 1,
    staleTime: Infinity,
  });

  if (!open) return null;

  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  const results = q.length >= 2 ? data?.results || [] : POPULAR_MANAGERS.slice(0, 8);
  // the same stock lookup as the home search: universe tickers and names,
  // a bare symbol jump only when the universe has nothing
  const stocks = matchStocks(universe?.rows, q, 3);
  const tickerish = TICKERISH.test(q);
  const direct = tickerish && q && !stocks.length ? q.toUpperCase() : null;
  const enterTicker = stocks[0]?.ticker === q.toUpperCase() ? stocks[0].ticker : direct;
  const tracked = results.filter((r) => r.guru);
  const others = results.filter((r) => !r.guru);
  const managerItem = (r) => (
    <button key={r.cik} className="search-result-item" onClick={() => go(managerPath(r.cik))}>
      <span><Ico icon={Landmark} /> {r.name}</span>
    </button>
  );

  return (
    <div className="palette-overlay" onMouseDown={() => setOpen(false)}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-input sm"
          placeholder={t('palette.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && enterTicker) go(`/stock/${enterTicker}`);
          }}
        />
        <div className="palette-results">
          {tracked.map(managerItem)}
          {stocks.map((st) => (
            <button key={`stk-${st.ticker}`} className="search-result-item" onClick={() => go(`/stock/${st.ticker}`)}>
              <span><Ico icon={ChartCandlestick} /> <b>{st.ticker}</b> {st.issuer}</span>
              {st.ticker === enterTicker && <span className="cik">Enter ↵</span>}
            </button>
          ))}
          {direct && (
            <button className="search-result-item" onClick={() => go(`/stock/${direct}`)}>
              <span><Ico icon={ChartCandlestick} /> {t('palette.goStock')} <b>{direct}</b></span>
              <span className="cik">Enter ↵</span>
            </button>
          )}
          {isFetching && <div className="search-result-item muted">{t('common.loading')}</div>}
          {others.map(managerItem)}
          {q.length >= 2 && !isFetching && !results.length && !stocks.length && !direct && (
            <div className="search-result-item muted">{t('search.noResults')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
