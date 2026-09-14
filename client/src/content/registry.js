// Static content pages (guides, comparison pages). Slugs differ per language,
// so each entry carries both paths; hreflang and canonical use them.
export const GUIDES = [
  {
    id: 'what-is-13f',
    paths: { en: '/guides/what-is-13f', tr: '/rehber/13f-nedir' },
    title: { en: 'What is a 13F filing?', tr: '13F bildirimi nedir?' },
    summary: { en: 'who must file, what it shows, what it leaves out', tr: 'kim bildirir, ne gösterir, neyi göstermez' },
  },
  {
    id: 'how-to-read-form-4',
    paths: { en: '/guides/how-to-read-form-4', tr: '/rehber/form-4-nasil-okunur' },
    title: { en: 'How to read a Form 4 insider filing', tr: 'Form 4 insider bildirimi nasıl okunur?' },
    summary: { en: 'transaction codes, 10b5-1 plans, what counts as a signal', tr: 'işlem kodları, 10b5-1 planları, sinyal sayılan işlemler' },
  },
  {
    id: '13f-limitations',
    paths: { en: '/guides/13f-limitations', tr: '/rehber/13f-sinirlari' },
    title: { en: 'Limitations of 13F data', tr: '13F verisinin sınırları' },
    summary: { en: 'the 45-day lag, long-only, missing asset classes', tr: '45 günlük gecikme, yalnız uzun pozisyonlar, eksik varlık sınıfları' },
  },
  {
    id: 'best-13f-trackers',
    paths: { en: '/guides/best-13f-trackers', tr: '/rehber/en-iyi-13f-takip-araclari' },
    title: { en: 'Best 13F trackers compared', tr: 'En iyi 13F takip araçları karşılaştırması' },
    summary: { en: 'feature matrix of the main 13F tools', tr: 'başlıca 13F araçlarının özellik matrisi' },
  },
];

export const COMPARES = [
  { id: 'whalewisdom', paths: { en: '/compare/13f-radar-vs-whalewisdom', tr: '/karsilastir/13f-radar-vs-whalewisdom' }, title: { en: 'Fundocap vs WhaleWisdom', tr: 'Fundocap vs WhaleWisdom' } },
  { id: 'dataroma', paths: { en: '/compare/13f-radar-vs-dataroma', tr: '/karsilastir/13f-radar-vs-dataroma' }, title: { en: 'Fundocap vs Dataroma', tr: 'Fundocap vs Dataroma' } },
  { id: '13radar', paths: { en: '/compare/13f-radar-vs-13radar', tr: '/karsilastir/13f-radar-vs-13radar' }, title: { en: 'Fundocap vs 13radar.com', tr: 'Fundocap vs 13radar.com' } },
];

export const contentByPath = (path) => {
  for (const g of GUIDES) for (const lang of ['en', 'tr']) if (g.paths[lang] === path) return { kind: 'guide', entry: g, lang };
  for (const c of COMPARES) for (const lang of ['en', 'tr']) if (c.paths[lang] === path) return { kind: 'compare', entry: c, lang };
  return null;
};
