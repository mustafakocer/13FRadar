import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import GuruBrowser from '../components/GuruBrowser.jsx';
import { breadcrumbs } from '../lib/seoTemplates.js';
import Ico from '../components/Ico.jsx';
import { Compass } from 'lucide-react';

// Index of curated superinvestors — every guru page is one click from here.
export default function Gurus() {
  const { t, lang } = useI18n();
  const gurus = useQuery({ queryKey: ['gurus'], queryFn: api.gurus, staleTime: Infinity });
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Usta Yatırımcılar: Portföyleri ve 13F Bildirimleri | Fundocap' : 'Superinvestors: Portfolios & 13F Filings | Fundocap',
        description:
          lang === 'tr'
            ? "Warren Buffett, Bill Ackman, Michael Burry ve diğer efsane yatırımcıların çeyreklik 13F portföyleri: pozisyonlar, alımlar, satışlar."
            : 'Quarterly 13F portfolios of Warren Buffett, Bill Ackman, Michael Burry and other legendary investors: holdings, buys and sells.',
        path: '/gurus',
        jsonLd: [breadcrumbs(lang, [[t('nav.gurus'), '/gurus']])],
      }),
      [lang, t]
    )
  );
  const slugByCik = useMemo(() => new Map((gurus.data?.rows || []).map((r) => [r.cik, r.slug])), [gurus.data]);
  return (
    <div>
      <div className="page-head">
        <div>
          <h1><Ico icon={Compass} size={22} /> {t('gurus.title')}</h1>
          <div className="sub">{t('gurus.subtitle')}</div>
        </div>
      </div>
      {/* the registry with the home page's category tabs and closed switch;
          the slug table gives each card its canonical URL */}
      <GuruBrowser variant="cards" pathFor={(g) => (slugByCik.get(g.cik) ? `/guru/${slugByCik.get(g.cik)}` : null)} />
      <p className="muted small mt16">
        <Link to="/filers">{t('gurus.allFilers')} →</Link>
      </p>
    </div>
  );
}
