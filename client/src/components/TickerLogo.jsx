import { useState } from 'react';
import { useLogos } from '../hooks/useLogos.js';

// The stock's own favicon when the nightly job found one (served from this
// site, never a third-party logo service), else a tinted two-letter badge —
// the same idea as the fund cards' initials. Decorative: hidden from
// assistive tech, the ticker text next to it carries the meaning.
const HUES = [212, 338, 158, 28, 268, 2, 98, 190, 48, 310];
const hueOf = (s) => HUES[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export default function TickerLogo({ ticker, size = 20 }) {
  const logos = useLogos();
  const [broken, setBroken] = useState(false);
  const sym = String(ticker || '').trim().toUpperCase();
  if (!sym) return null;
  const file = logos[sym] || logos[sym.replace(/\./g, '-')];
  if (file && !broken) {
    return (
      <img
        className="tlogo"
        src={`/${String(file).replace(/^\//, '')}`}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  const h = hueOf(sym);
  // the letters come from CSS (attr), not text: screen readers, search
  // engines and copy-paste read the ticker once, from the label next to it
  return (
    <span
      className="tlogo tlogo-badge"
      aria-hidden="true"
      data-sym={sym.replace(/[^A-Z0-9]/g, '').slice(0, 2)}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `hsl(${h} 55% 45% / 0.16)`,
        color: `hsl(${h} 55% 38%)`,
      }}
    />
  );
}
