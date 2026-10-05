import { displayCompany } from '../lib/label.js';

// One company name, printed the same way everywhere: the short readable form
// in the cell, the full registry name in the tooltip. `name` should be the
// cleanest name at hand (the SEC name when the row carries one, else the 13F
// issuer).
export default function CompanyName({ name, className, maxWords }) {
  const { short, full } = displayCompany(name, maxWords ? { maxWords } : undefined);
  if (!short) return <span className={className}>—</span>;
  return (
    <span className={className} title={full !== short ? full : undefined}>
      {short}
    </span>
  );
}
