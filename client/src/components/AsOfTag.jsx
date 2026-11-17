import { useI18n } from '../i18n.jsx';
import { quarterLabel } from '../lib/format.js';

// A fund in a consensus list whose newest 13F is older than the list's
// quarter (it has not filed yet): its line is last quarter's book, so a
// "reduced 95%" next to it is that older quarter's move, not this one's.
// `asOf` is the fund's period of report; the build sets it only on lagging
// holders (api/_lib/consensusBuild.js).
export default function AsOfTag({ asOf }) {
  const { t } = useI18n();
  if (!asOf) return null;
  const label = quarterLabel(asOf);
  return (
    <span className="muted small" title={t('consensus.asOfTip').replace('{q}', label)} style={{ whiteSpace: 'nowrap' }}>
      {' '}({label})
    </span>
  );
}
