import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';
import { fmtNum } from '../lib/format.js';
import Ico from './Ico.jsx';
import { Lock } from 'lucide-react';

// The one way a Pro section shows itself to a free reader: the preview (the
// first rows, the sample comparison) stays on the page, and the lock box
// sits UNDER it saying what the rest is — "the remaining 21,405 trades with
// Pro" — with the upgrade link. A Pro reader gets `children` and nothing
// else. This is the guru page's "top ten positions, then the lock" rule,
// made into a component so every gated page reads the same.
//
//   <ProGate preview={<Table rows={first10} />} remaining={total - 10} unit={t('paywall.unit.trades')}>
//     <Table rows={all} />
//   </ProGate>
//
// With no `preview` and no `children` it is just the lock box (a table that
// already trimmed itself). `note` replaces the remaining-count sentence
// when there is no count to give; `cta` is where the button goes.
export default function ProGate({ children = null, preview = null, remaining = null, unit = null, note = null, cta = '/pricing', title = null, compact = true }) {
  const { isPro } = useAuth();
  const { t } = useI18n();
  if (isPro) return children;
  const sentence =
    remaining != null && remaining > 0
      ? t('paywall.remaining').replace('{n}', fmtNum(remaining)).replace('{unit}', unit || t('paywall.unit.rows'))
      : note || t('paywall.desc');
  return (
    <>
      {preview}
      <div className="card paywall mt16" style={compact ? { padding: 14 } : {}} data-pro-gate>
        <div className="paywall-lock"><Ico icon={Lock} size={22} /></div>
        <h3>{title || t('paywall.title')}</h3>
        <p className="muted small">{sentence}</p>
        <Link to={cta} className="btn" style={{ textDecoration: 'none' }}>
          {t('paywall.cta')}
        </Link>
      </div>
    </>
  );
}
