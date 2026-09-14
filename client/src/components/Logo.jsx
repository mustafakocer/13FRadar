// The Fundocap mark: an F whose two arms are weighted bars against the stem.
// It reads as the initial and as a fund's largest holdings on an axis, which
// is what the site is. The top arm — the biggest position — takes the accent;
// everything else follows the text colour, so the mark works in both themes
// and anywhere an icon sits inline.
//
// Drawn on the same 24-unit grid as the lucide icons around it, but filled
// rather than stroked: a brand mark should carry slightly more weight than the
// navigation icons it sits next to.
export default function Logo({ size = 22, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={`ico-svg ${className}`.trim()}
    >
      <rect x="3.9" y="3.3" width="3.4" height="17.4" rx="1.7" fill="currentColor" />
      <rect x="8.9" y="3.3" width="11.2" height="3.4" rx="1.7" fill="var(--accent)" />
      <rect x="8.9" y="9.8" width="7.1" height="3.4" rx="1.7" fill="currentColor" />
    </svg>
  );
}
