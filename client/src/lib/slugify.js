// Shared by the API (stored slug table) and the client (links to curated
// gurus). ASCII, lowercase, hyphenated, never truncated.
// letters NFKD cannot decompose to ASCII
const SPECIAL = { ı: 'i', ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', đ: 'd', ł: 'l', þ: 'th', ð: 'd' };

export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[ıßøæœđłþð]/g, (c) => SPECIAL[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
