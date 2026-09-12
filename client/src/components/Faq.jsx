import { useI18n } from '../i18n.jsx';
import Ico from './Ico.jsx';
import { CircleHelp, Info } from 'lucide-react';

// Visible FAQ block (the same items feed the FAQPage JSON-LD via useSeo).
export default function Faq({ items }) {
  const { t } = useI18n();
  if (!items?.length) return null;
  return (
    <section className="card mt16 faq" aria-label={t('seo.faq')}>
      <h3><Ico icon={CircleHelp} /> {t('seo.faq')}</h3>
      {items.map(([q, a]) => (
        <details key={q} open>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
    </section>
  );
}

export function Disclaimer() {
  const { t } = useI18n();
  return <p className="disclaimer"><Ico icon={Info} size={14} /> <span>{t('seo.disclaimer')}</span></p>;
}
