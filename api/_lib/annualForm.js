// Which kind of annual report does a company file now? A foreign private
// issuer files a 20-F (or a 40-F from Canada); a company that has given up
// that status files a 10-K like any US company. SEC submissions keep both
// in the history, so "has ever filed a 20-F" (what build-fpi used to ask)
// keeps a company foreign long after it moved: Indivior, Merus and Summit
// file 10-Ks and trade in dollars, one share per share.
//
// filings: [{ form, date }] (the submissions feed, newest first or not)
// → { status: 'domestic' | 'foreign' | 'unclear', tenK, foreignAnnual, reason }
export const TEN_K = /^10-K(T)?$/;
export const FOREIGN_ANNUAL = /^(20-F|40-F)$/;

export function annualStatus(filings = []) {
  const newest = (re) => filings.filter((f) => re.test(f.form)).reduce((m, f) => (f.date > m ? f.date : m), '');
  const tenK = newest(TEN_K) || null;
  const foreignAnnual = newest(FOREIGN_ANNUAL) || null;
  if (tenK && (!foreignAnnual || tenK > foreignAnnual)) return { status: 'domestic', tenK, foreignAnnual, reason: `10-K ${tenK}${foreignAnnual ? ` after 20-F/40-F ${foreignAnnual}` : ''}` };
  if (foreignAnnual) return { status: 'foreign', tenK, foreignAnnual, reason: `20-F/40-F ${foreignAnnual}${tenK ? ` after 10-K ${tenK}` : ''}` };
  return { status: 'unclear', tenK, foreignAnnual, reason: 'no annual report (10-K, 20-F, 40-F) in the recent filings' };
}
