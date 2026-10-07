import { useState } from 'react';
import { useLogos, useDomains } from '../hooks/useLogos.js';

// A stock's logo, by preference:
//   1. the brand icon from the logo CDN (Brandfetch Logo Link) when the build
//      carries a client id (VITE_BRANDFETCH_CLIENT_ID) and the weekly job
//      found the company's domain — fetched by the reader's browser, with
//      the CDN told to answer 404 (not its own lettermark) for an unknown
//      brand, so the fallback below is always ours;
//   2. the company's own favicon when the nightly job found one (served
//      from this site);
//   3. a tinted two-letter badge — the same idea as the fund cards' initials.
// Decorative: hidden from assistive tech, the ticker text next to it carries
// the meaning.
const CLIENT_ID = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BRANDFETCH_CLIENT_ID) || '';
// {domain} {px} {id} are filled in; overridable should the CDN's path grammar change
const CDN_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BRANDFETCH_URL) || 'https://cdn.brandfetch.io/{domain}/w/{px}/h/{px}/fallback/404?c={id}';
export const cdnEnabled = () => Boolean(CLIENT_ID);
// 2× for high-density screens, in the CDN's size steps so the cache hits
const cdnPx = (size) => (size <= 20 ? 64 : size <= 40 ? 128 : 256);
export const cdnSrc = (domain, size) => CDN_URL.replace('{domain}', domain).replace(/\{px\}/g, String(cdnPx(size))).replace('{id}', CLIENT_ID);

const HUES = [212, 338, 158, 28, 268, 2, 98, 190, 48, 310];
const hueOf = (s) => HUES[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % HUES.length];

export default function TickerLogo({ ticker, size = 20 }) {
  const logos = useLogos();
  const domains = useDomains();
  // which sources have failed for this ticker: the CDN first, then the file
  const [broken, setBroken] = useState({});
  // "GPN 1.5 03-01-31" (a convertible) and "EA*" are GPN and EA
  const sym = String(ticker || '').trim().toUpperCase().split(/\s+/)[0].replace(/\*+$/, '');
  if (!sym) return null;
  const alt = sym.replace(/\./g, '-');
  const domain = CLIENT_ID ? domains[sym] || domains[alt] : null;
  const file = logos[sym] || logos[alt];
  const src = domain && !broken.cdn ? cdnSrc(domain, size) : file && !broken.file ? `/${String(file).replace(/^\//, '')}` : null;
  if (src) {
    return (
      <img
        className="tlogo"
        src={src}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => setBroken((b) => ({ ...b, [domain && !b.cdn ? 'cdn' : 'file']: true }))}
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
