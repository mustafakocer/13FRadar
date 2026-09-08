import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';

// Debounced EDGAR manager search with a results dropdown.
// onSelect(manager) — manager: {cik, name}
export default function SearchBox({ onSelect, placeholder, small = false, autoFocus = false }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
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

  const results = data?.results || [];

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
      />
      {open && q.length >= 2 && (
        <div className="search-results">
          {isFetching && <div className="search-result-item muted">{t('common.loading')}</div>}
          {!isFetching && !results.length && (
            <div className="search-result-item muted">{t('search.noResults')}</div>
          )}
          {results.map((r) => (
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
              <span className="cik">
                CIK {r.cik}
                {r.filings ? ` · ${r.filings} ${t('search.filings')}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
