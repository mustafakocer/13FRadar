import { useMemo } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { useSeo } from '../seo.jsx';
import { breadcrumbs, faqJsonLd } from '../lib/seoTemplates.js';
import { article, webPage } from '../lib/jsonld.js';
import { contentByPath, GUIDES, COMPARES, LEGAL } from '../content/registry.js';
import { GUIDE_CONTENT } from '../content/guides.js';
import { LEGAL_CONTENT, CONTACT_EMAIL, LEGAL_UPDATED } from '../content/legal.js';
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

// The privacy notice and the terms: sections, the contact line, WebPage
// JSON-LD — no answer box, no FAQ, no matrix.
function LegalPage({ entry, lang, t }) {
  const content = LEGAL_CONTENT[entry.id][lang];
  const path = entry.paths[lang];
  useSeo(
    useMemo(
      () => ({
        title: `${content.title} | Fundocap`,
        description: content.lead.slice(0, 155),
        path,
        paths: entry.paths,
        dateModified: LEGAL_UPDATED,
        jsonLd: [
          webPage({ name: content.title, description: content.lead.slice(0, 300), lang, path, dateModified: LEGAL_UPDATED }),
          breadcrumbs(lang, [[content.title, path]]),
        ],
      }),
      [content, lang, path, entry]
    )
  );
  return (
    <article data-legal={entry.id}>
      <div className="page-head">
        <div>
          <h1>{content.title}</h1>
          <div className="sub">{t('legal.updated').replace('{d}', LEGAL_UPDATED)}</div>
        </div>
      </div>
      <div className="card"><p className="about-text">{content.lead}</p></div>
      {content.sections.map((s) => (
        <section key={s.h2} className="card mt16">
          <h2 style={{ fontSize: 20, marginBottom: 10 }}>{s.h2}</h2>
          {s.p.map((p, i) => <p key={i} className="about-text" style={{ marginBottom: 10 }}>{p}</p>)}
        </section>
      ))}
      <div className="card mt16" data-legal-contact>
        <b>{t('legal.contactTitle')}</b>
        <p className="about-text" style={{ marginTop: 6 }}>
          {t('legal.contact')} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
        <div className="row mt8">
          {LEGAL.filter((l) => l.id !== entry.id).map((l) => <Link key={l.id} to={l.paths[lang]} className="chip">{l.title[lang]}</Link>)}
        </div>
      </div>
    </article>
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
  if (hit.kind === 'legal') return <LegalPage entry={hit.entry} lang={lang} t={t} />;
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
