import { useMemo } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { breadcrumbs, faqJsonLd } from '../lib/seoTemplates.js';
import { article } from '../lib/jsonld.js';
import { contentByPath, GUIDES, COMPARES } from '../content/registry.js';
import { GUIDE_CONTENT } from '../content/guides.js';
import { COMPARE_CONTENT, BEST_TRACKERS, MATRIX_ROWS, MATRIX_LABEL, US } from '../content/compare.js';
import AnswerBox from '../components/AnswerBox.jsx';
import Faq, { Disclaimer } from '../components/Faq.jsx';

const PUBLISHED = '2026-09-11';

function Matrix({ lang, columns, cells }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th className="l">{lang === 'tr' ? 'Ölçüt' : 'Criterion'}</th>{columns.map((c) => <th key={c} className="l">{c}</th>)}</tr></thead>
        <tbody>
          {MATRIX_ROWS.map((r) => (
            <tr key={r}>
              <td className="l"><b>{MATRIX_LABEL[lang][r]}</b></td>
              {columns.map((c, i) => <td key={c} className={`l ${i > 0 && cells[i][r] === 'TODO' ? 'muted' : ''}`}>{cells[i][r]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Static guides and comparison pages. Slugs differ per language; a URL in
// the other language's slug redirects to the right one.
export default function ContentPage() {
  const { pathname } = useLocation();
  const { t, lang } = useI18n();
  const hit = contentByPath(pathname);
  if (!hit) return <div className="error-box">{t('common.error')}</div>;
  if (hit.lang !== lang) return <Navigate to={hit.entry.paths[lang]} replace />;
  const { kind, entry } = hit;
  const content = kind === 'guide' ? (entry.id === 'best-13f-trackers' ? BEST_TRACKERS[lang] : GUIDE_CONTENT[entry.id][lang]) : COMPARE_CONTENT[entry.id][lang];
  const path = entry.paths[lang];
  const crumbRoot = kind === 'guide' ? [lang === 'tr' ? 'Rehberler' : 'Guides', GUIDES[0].paths[lang]] : [lang === 'tr' ? 'Karşılaştırmalar' : 'Comparisons', COMPARES[0].paths[lang]];

  useSeo(
    useMemo(
      () => ({
        title: `${content.title} | Fundocap`,
        description: content.lead.slice(0, 155),
        answer: content.lead,
        path,
        paths: entry.paths,
        type: 'article',
        dateModified: PUBLISHED,
        jsonLd: [
          article({ headline: content.title, description: content.lead.slice(0, 300), lang, path, datePublished: PUBLISHED, dateModified: PUBLISHED }),
          faqJsonLd(content.faq),
          breadcrumbs(lang, [crumbRoot, [content.title, path]]),
        ],
      }),
      [content, lang, path, entry, crumbRoot]
    )
  );

  const matrixCells = kind === 'compare' ? [US[lang], content.matrix] : entry.id === 'best-13f-trackers' ? [US[lang], ...content.columns.slice(1).map(() => Object.fromEntries(MATRIX_ROWS.map((r) => [r, 'TODO'])))] : null;
  const columns = kind === 'compare' ? ['Fundocap', content.them] : content.columns;

  return (
    <article>
      <div className="page-head"><div><h1>{content.title}</h1></div></div>
      <AnswerBox text={content.lead} />
      {matrixCells && (
        <div className="card">
          <h3>{lang === 'tr' ? 'Özellik matrisi' : 'Feature matrix'}</h3>
          <Matrix lang={lang} columns={columns} cells={matrixCells} />
          <p className="muted small mt8">{lang === 'tr' ? 'TODO: rakip hücreleri, ürünün güncel sayfasıyla doğrulandıktan sonra elle doldurulacak; doğrulanmamış bilgi yazılmaz.' : 'TODO: competitor cells are filled by hand after checking the product\'s current pages; unverified facts are not written.'}</p>
        </div>
      )}
      {(content.sections || []).map((s) => (
        <section key={s.h2} className="card mt16">
          <h2 style={{ fontSize: 20, marginBottom: 10 }}>{s.h2}</h2>
          {s.p.map((p, i) => <p key={i} className="about-text" style={{ marginBottom: 10 }}>{p}</p>)}
        </section>
      ))}
      {content.links && (
        <div className="card mt16">
          <h3>{lang === 'tr' ? 'İlgili sayfalar' : 'Related pages'}</h3>
          <div className="row">{content.links.map(([label, to]) => <Link key={to} to={to} className="chip">{label}</Link>)}</div>
        </div>
      )}
      <div className="card mt16">
        <h3>{lang === 'tr' ? 'Diğer rehberler' : 'More guides'}</h3>
        <div className="row">
          {[...GUIDES, ...COMPARES].filter((g) => g.id !== entry.id).map((g) => <Link key={g.id} to={g.paths[lang]} className="chip">{g.title[lang]}</Link>)}
        </div>
      </div>
      <Faq items={content.faq} />
      <Disclaimer />
    </article>
  );
}
