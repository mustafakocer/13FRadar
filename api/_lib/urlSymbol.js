// The one spelling of "a symbol that can be the last segment of a page URL":
// letters, digits, dot and hyphen, at most twelve characters. The page routes
// (/stock/:ticker, /guru/:slug/:ticker) accept exactly this and the sitemap
// lists exactly this, so the sitemap can never name an address the router
// refuses. A 13F row for a bond or a preferred share carries a "ticker" such
// as `WFC 7.5 PERP L`; it has no page and must not get a URL.
export const URL_SYMBOL_SRC = '[A-Za-z0-9.\\-]{1,12}';
const URL_SYMBOL_RE = new RegExp(`^${URL_SYMBOL_SRC}$`);
export const isUrlSymbol = (s) => typeof s === 'string' && URL_SYMBOL_RE.test(s);
