import { useI18n } from '../i18n.jsx';
import { quarterLabel } from '../lib/format.js';

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// The one sentence that reconciles the fund counts a reader meets across the
// site: how many superinvestors are tracked, how many of them have filed for
// the quarter, and how many of those the number on the page is computed
// over. Reads the `coverage` object the builds write (api/_lib/gurus.js
// coverage()); renders nothing when a file predates it.
export default function CoverageLine({ coverage, className = 'muted small' }) {
  const { t } = useI18n();
  if (!coverage || !Number.isFinite(coverage.tracked)) return null;
  const q = coverage.quarter ? quarterLabel(coverage.quarter) : '';
  const line = fill(t('coverage.line'), { tracked: coverage.tracked, filed: coverage.filed, included: coverage.included, q });
  const ex = coverage.excluded || {};
  const parts = [];
  if (ex['not-filed'] > 0) parts.push(fill(t('coverage.notFiled'), { n: ex['not-filed'] }));
  if (ex['wide-book'] > 0) parts.push(fill(t('coverage.wideBook'), { n: ex['wide-book'] }));
  return (
    <p className={className} data-coverage={`${coverage.tracked}/${coverage.filed}/${coverage.included}`}>
      {line}
      {parts.length > 0 && <> — {parts.join(' · ')}</>}
    </p>
  );
}
