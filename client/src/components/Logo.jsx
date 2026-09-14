// The Fundocap mark: a market line inside a ring, with the accent on the
// latest point. The ring is the scope — the site watches what the big funds
// hold — and the line is what it watches. The accent dot is the position the
// eye lands on; everything else follows the text colour, so the mark works in
// both themes and anywhere an icon sits inline.
//
// Drawn on the same 24-unit grid as the lucide icons around it, stroked a
// touch heavier than they are: a brand mark should carry slightly more weight
// than the navigation icons it sits next to. The dot stays clear of the ring
// at every size (checked at 16, 20, 22, 32 and 64px in both themes).
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
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="2.2" />
      <path
        d="M6.5 15.5 L10 11.5 L12.8 13.8 L16.6 9.2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16.6" cy="9.2" r="2.3" fill="var(--accent)" />
    </svg>
  );
}
