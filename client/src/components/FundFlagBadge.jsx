import { useI18n } from '../i18n.jsx';

// The small badge next to a fund's name in the lists (client/public/fund-flags.json):
// its SEC filing does not add up ("filing error" once reviewed, "under
// review" before), or its latest filing is old ("old filing": nothing for a
// newer period, or last quarter's table under a new cover). The fund's page
// explains.
const LABEL = {
  review: ['flag.review', 'flag.reviewTip'],
  stale: ['flag.stale', 'flag.staleTip'],
  'previous-table': ['flag.stale', 'flag.previousTip'],
};
export default function FundFlagBadge({ flag }) {
  const { t } = useI18n();
  if (!flag) return null;
  const [label, tip] = LABEL[flag.kind] || ['flag.error', 'flag.errorTip'];
  return (
    <span className="badge warn sm" style={{ marginLeft: 6 }} title={t(tip)} data-flag={flag.kind}>
      {' '}{t(label)}
    </span>
  );
}
