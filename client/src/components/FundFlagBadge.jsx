import { useI18n } from '../i18n.jsx';

// The small badge next to a fund's name in the lists: its SEC filing does not
// add up (client/public/fund-flags.json). Reviewed ones say "filing error",
// the rest "under review"; the fund's page explains.
export default function FundFlagBadge({ flag }) {
  const { t } = useI18n();
  if (!flag) return null;
  const review = flag.kind === 'review';
  return (
    <span className="badge warn sm" style={{ marginLeft: 6 }} title={t(review ? 'flag.reviewTip' : 'flag.errorTip')} data-flag={flag.kind}>
      {' '}{t(review ? 'flag.review' : 'flag.error')}
    </span>
  );
}
