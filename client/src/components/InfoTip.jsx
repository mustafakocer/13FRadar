import { useI18n } from '../i18n.jsx';
import Ico from './Ico.jsx';
import { Info } from 'lucide-react';

// ⓘ hover/tap tooltip for financial jargon — one-sentence plain explanations.
export default function InfoTip({ tip }) {
  const { t } = useI18n();
  const text = t(tip);
  if (!text || text === tip) return null;
  return (
    <span className="tip" tabIndex={0} aria-label={text}>
      <Ico icon={Info} size={14} /><span className="tip-box">{text}</span>
    </span>
  );
}
