import { useEffect, useRef, useState } from 'react';
import Ico from './Ico.jsx';
import { Check } from 'lucide-react';

// Fintables-style dropdown filter: pill button + popover option list.
// options: [{ v, label }] — v '' means "all".
export default function FilterSelect({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const active = options.find((o) => o.v === value);
  const isSet = value !== '';

  return (
    <div className="fsel" ref={ref}>
      <button
        className={`chip${isSet ? ' fsel-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {isSet ? `: ${active?.label}` : ''} <span className="muted">▾</span>
      </button>
      {open && (
        <div className="fsel-pop">
          {options.map((o) => (
            <button
              key={o.v}
              className="search-result-item"
              onClick={() => {
                onChange(o.v);
                setOpen(false);
              }}
            >
              <span>{o.label}</span>
              {o.v === value && <Ico icon={Check} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
