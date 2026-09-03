import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { POPULAR_MANAGERS } from '../data/popular.js';
import { useI18n } from '../i18n.jsx';

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

  if (!open) return null;

  const go = (path) => {
    setOpen(false);
    navigate(path);
  };

  const results = q.length >= 2 ? data?.results || [] : POPULAR_MANAGERS.slice(0, 8);
  const tickerish = /^[A-Za-z][A-Za-z.-]{0,6}$/.test(q);

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
            if (e.key === 'Enter' && tickerish && q) go(`/stock/${q.toUpperCase()}`);
          }}
        />
        <div className="palette-results">
          {tickerish && q && (
            <button className="search-result-item" onClick={() => go(`/stock/${q.toUpperCase()}`)}>
              <span>💹 {t('palette.goStock')} <b>{q.toUpperCase()}</b></span>
              <span className="cik">Enter ↵</span>
            </button>
          )}
          {isFetching && <div className="search-result-item muted">{t('common.loading')}</div>}
          {results.map((r) => (
            <button key={r.cik} className="search-result-item" onClick={() => go(`/manager/${r.cik}`)}>
              <span>🏦 {r.name}</span>
              <span className="cik">CIK {r.cik}</span>
            </button>
          ))}
          {q.length >= 2 && !isFetching && !results.length && (
            <div className="search-result-item muted">{t('search.noResults')}</div>
          )}
        </div>
      </div>
    </div>
  );
}
