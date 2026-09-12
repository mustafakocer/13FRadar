import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { breadcrumbs } from '../lib/seoTemplates.js';

const LETTERS = ['0', ...'abcdefghijklmnopqrstuvwxyz'];

// A–Z directory of every 13F filer: home → /filers/x → /filer/slug keeps
// each of the ~8,000 filer pages within three clicks of the home page.
export default function Filers() {
  const { letter = 'a' } = useParams();
  const { t, lang } = useI18n();
  const key = LETTERS.includes(letter) ? letter : 'a';
  const list = useQuery({ queryKey: ['filers', key], queryFn: () => api.filersByLetter(key), staleTime: Infinity });
  const label = key === '0' ? '0-9' : key.toUpperCase();
  useSeo(
    useMemo(
      () => ({
        title: lang === 'tr' ? `13F Dosyalayan Kurumlar — ${label} | 13F Radar` : `13F Filers Directory — ${label} | 13F Radar`,
        description:
          lang === 'tr'
            ? `SEC'e 13F bildirimi yapan kurumsal yatırımcılar (${label} harfi). Her fonun portföyü, AUM ve çeyreklik değişimleri.`
            : `Institutional investors filing Form 13F with the SEC (letter ${label}). Each fund's portfolio, AUM and quarterly changes.`,
        path: `/filers/${key}`,
        jsonLd: [breadcrumbs(lang, [[t('filers.title'), '/filers'], [label, `/filers/${key}`]])],
      }),
      [lang, key, label, t]
    )
  );
  const rows = list.data?.rows || [];
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>🏦 {t('filers.title')}</h1>
          <div className="sub">{t('filers.subtitle')}</div>
        </div>
      </div>
      <div className="row" style={{ gap: 6, marginBottom: 16 }}>
        {LETTERS.map((l) => (
          <Link key={l} to={`/filers/${l}`} className={`chip${l === key ? ' fsel-active' : ''}`}>
            {l === '0' ? '0-9' : l.toUpperCase()}
          </Link>
        ))}
      </div>
      {list.isLoading && <div className="loading"><div className="spinner" />{t('common.loading')}</div>}
      <div className="card">
        <h3>{label} · {rows.length}</h3>
        <ul className="filer-list">
          {rows.map((r) => (
            <li key={r.slug}>
              <Link to={`/${r.kind === 'guru' ? 'guru' : 'filer'}/${r.slug}`}>{r.name}</Link>
              <span className="muted small"> · CIK {r.cik}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
