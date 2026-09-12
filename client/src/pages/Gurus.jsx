import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { managerStyle } from '../data/popular.js';
import { breadcrumbs } from '../lib/seoTemplates.js';

// Index of curated superinvestors — every guru page is one click from here.
export default function Gurus() {
  const { t, lang } = useI18n();
  const gurus = useQuery({ queryKey: ['gurus'], queryFn: api.gurus, staleTime: Infinity });
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? 'Usta Yatırımcılar: Portföyleri ve 13F Bildirimleri | 13F Radar' : 'Superinvestors: Portfolios & 13F Filings | 13F Radar',
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
  const rows = gurus.data?.rows || [];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🧭 {t('gurus.title')}</h1>
          <div className="sub">{t('gurus.subtitle')}</div>
        </div>
      </div>
      {gurus.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      <div className="grid grid-3">
        {rows.map((g) => (
          <Link key={g.slug} to={`/guru/${g.slug}`} className="card feature-card">
            <h3>{g.name}</h3>
            <p className="muted small">
              {managerStyle(g.cik) ? t(`style.${managerStyle(g.cik)}`) + ' · ' : ''}CIK {g.cik}
            </p>
          </Link>
        ))}
      </div>
      <p className="muted small mt16">
        <Link to="/filers">{t('gurus.allFilers')} →</Link>
      </p>
    </div>
  );
}
