// Static content pages (guides, comparison pages). The site is Turkish-only:
// `paths.tr` is the live slug; `paths.en` is kept solely so retired English
// URLs 301 to their Turkish twin.
export const GUIDES = [
  {
    id: 'what-is-13f',
    paths: { en: '/guides/what-is-13f', tr: '/rehber/13f-nedir' },
    title: { tr: '13F bildirimi nedir?' },
    summary: { tr: 'kim bildirir, ne gösterir, neyi göstermez' },
  },
  {
    id: 'how-to-read-form-4',
    paths: { en: '/guides/how-to-read-form-4', tr: '/rehber/form-4-nasil-okunur' },
    title: { tr: 'Form 4 insider bildirimi nasıl okunur?' },
    summary: { tr: 'işlem kodları, 10b5-1 planları, sinyal sayılan işlemler' },
  },
  {
    id: '13f-limitations',
    paths: { en: '/guides/13f-limitations', tr: '/rehber/13f-sinirlari' },
    title: { tr: '13F verisinin sınırları' },
    summary: { tr: '45 günlük gecikme, yalnız uzun pozisyonlar, eksik varlık sınıfları' },
  },
  {
    id: 'best-13f-trackers',
    paths: { en: '/guides/best-13f-trackers', tr: '/rehber/en-iyi-13f-takip-araclari' },
    title: { tr: 'En iyi 13F takip araçları karşılaştırması' },
    summary: { tr: 'başlıca 13F araçlarının özellik matrisi' },
  },
];

export const COMPARES = [
  { id: 'whalewisdom', paths: { en: '/compare/13f-radar-vs-whalewisdom', tr: '/karsilastir/13f-radar-vs-whalewisdom' }, title: { tr: 'Fundocap vs WhaleWisdom' } },
  { id: 'dataroma', paths: { en: '/compare/13f-radar-vs-dataroma', tr: '/karsilastir/13f-radar-vs-dataroma' }, title: { tr: 'Fundocap vs Dataroma' } },
  { id: '13radar', paths: { en: '/compare/13f-radar-vs-13radar', tr: '/karsilastir/13f-radar-vs-13radar' }, title: { tr: 'Fundocap vs 13radar.com' } },
];

// Privacy notice and terms of use (content in legal.js). Required for the
// Google OAuth consent screen and Stripe; linked from the footer.
export const LEGAL = [
  { id: 'privacy', paths: { en: '/privacy', tr: '/gizlilik' }, title: { tr: 'Gizlilik Bildirimi' } },
  { id: 'terms', paths: { en: '/terms', tr: '/kullanim-sartlari' }, title: { tr: 'Kullanım Şartları' } },
];

export const contentByPath = (path) => {
  for (const g of GUIDES) for (const lang of ['en', 'tr']) if (g.paths[lang] === path) return { kind: 'guide', entry: g, lang };
  for (const c of COMPARES) for (const lang of ['en', 'tr']) if (c.paths[lang] === path) return { kind: 'compare', entry: c, lang };
  for (const l of LEGAL) for (const lang of ['en', 'tr']) if (l.paths[lang] === path) return { kind: 'legal', entry: l, lang };
  return null;
};
