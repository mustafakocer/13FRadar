// Company fundamentals from SEC XBRL (companyfacts, data.sec.gov) — the free,
// public filings themselves, read by the nightly job, so a stock page never
// asks a data vendor. Pure: the job hands in a company's companyfacts JSON and
// gets back what the page needs before a price is known.
//
//   eps      trailing twelve months, diluted: the last four quarters summed.
//            A 10-K reports the year, not its fourth quarter, so Q4 is the
//            year minus the first three quarters. A filer with no quarterly
//            XBRL (a 20-F: TSM, Toyota) has its last fiscal year instead,
//            labelled as such.
//   shares   dei:EntityCommonStockSharesOutstanding from the newest filing
//            that states it. A filer with several share classes states one
//            line per class; the classes are summed, after the per-ticker
//            rules in config/share-classes.json (Berkshire's Class A is 1,500
//            Class B shares).
//   divTtm   dividends declared per share over the last four quarters (or
//            the last fiscal year), same arithmetic as eps.
//
// Every value carries the filing it came from (form, period end, filed,
// accession → a link to the document on sec.gov). The page multiplies by the
// price it has: P/E = price / eps (a loss when eps ≤ 0), market cap =
// shares × price, yield = divTtm / price — see valuationFor below.

const DAY = 86_400_000;
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

// The concepts tried, in order. us-gaap first; IFRS filers (20-F) use the
// ifrs-full taxonomy with the amount in their reporting currency.
export const EPS_CONCEPTS = [
  ['us-gaap', 'EarningsPerShareDiluted'],
  ['us-gaap', 'EarningsPerShareBasicAndDiluted'],
  ['us-gaap', 'EarningsPerShareBasic'],
  ['ifrs-full', 'DilutedEarningsLossPerShare'],
  ['ifrs-full', 'BasicAndDilutedEarningsLossPerShare'],
  ['ifrs-full', 'BasicEarningsLossPerShare'],
];
// Fallback when no EPS concept is there (companyfacts leaves out the facts a
// filer tagged per share class — Berkshire states EPS per Class A and per
// Class B share — and some 20-F filers): net income over the diluted share
// count of the same period, labelled as such.
export const NET_INCOME_CONCEPTS = [
  ['us-gaap', 'NetIncomeLoss'],
  ['us-gaap', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  ['ifrs-full', 'ProfitLossAttributableToOwnersOfParent'],
  ['ifrs-full', 'ProfitLoss'],
];
// The share count of a period: diluted first.
export const WAVG_SHARE_CONCEPTS = [
  ['us-gaap', 'WeightedAverageNumberOfDilutedSharesOutstanding'],
  ['us-gaap', 'WeightedAverageNumberOfSharesOutstandingBasic'],
  ['ifrs-full', 'AdjustedWeightedAverageShares'],
  ['ifrs-full', 'WeightedAverageShares'],
];
export const DIV_CONCEPTS = [
  ['us-gaap', 'CommonStockDividendsPerShareDeclared'],
  ['us-gaap', 'CommonStockDividendsPerShareCashPaid'],
  ['ifrs-full', 'DividendsRecognisedAsDistributionsToOwnersPerShare'],
];

// "USD/shares" → "USD"; null for anything that is not an amount per share.
export const perShareCurrency = (unit) => (/^([A-Z]{3})\/shares$/.test(unit) ? unit.slice(0, 3) : null);

export const filingUrl = (cik, accn) =>
  cik && accn ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(accn).replace(/-/g, '')}/${accn}-index.htm` : null;

// One value per reported period (start–end): a period restated in a later
// filing keeps the later figure.
export function periods(entries) {
  const by = new Map();
  for (const e of entries || []) {
    if (!e?.start || !e?.end || !Number.isFinite(e.val)) continue;
    const k = `${e.start}|${e.end}`;
    const prev = by.get(k);
    if (!prev || String(e.filed) > String(prev.filed)) by.set(k, e);
  }
  return [...by.values()].map((e) => ({ start: e.start, end: e.end, val: e.val, accn: e.accn, form: e.form, filed: e.filed, len: days(e.start, e.end) }));
}

const isQuarter = (p) => p.len >= 80 && p.len <= 100;
const isYear = (p) => p.len >= 350 && p.len <= 380;

// Trailing twelve months from one concept's periods.
//   { value, basis: 'ttm' | 'annual', end, form, filed, accn, parts }
// null when there is nothing recent enough (asOf: no older than 15 months).
export function trailing(ps, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const quarters = ps.filter(isQuarter);
  const years = ps.filter(isYear);
  // Q4 = the year minus the three quarters inside it
  const derived = [];
  for (const y of years) {
    const inside = quarters.filter((q) => q.start >= y.start && q.end <= y.end && days(q.end, y.end) > 45);
    const distinct = [...new Map(inside.map((q) => [q.end, q])).values()];
    if (distinct.length !== 3) continue;
    const lastEnd = distinct.map((q) => q.end).sort().at(-1);
    if (quarters.some((q) => q.end === y.end)) continue;
    derived.push({
      start: lastEnd,
      end: y.end,
      val: y.val - distinct.reduce((s, q) => s + q.val, 0),
      accn: y.accn,
      form: y.form,
      filed: y.filed,
      len: days(lastEnd, y.end),
      derived: true,
    });
  }
  const all = [...new Map([...quarters, ...derived].map((q) => [q.end, q])).values()].sort((a, b) => a.end.localeCompare(b.end));
  const fresh = (end) => days(end, asOf) <= 460;
  const newestYear = years.sort((a, b) => a.end.localeCompare(b.end)).at(-1) || null;
  // the last four quarters, each about three months after the one before
  const four = all.slice(-4);
  const chained = four.length === 4 && four.every((q, i) => i === 0 || Math.abs(days(four[i - 1].end, q.end) - 91) <= 20);
  if (chained && fresh(four[3].end) && (!newestYear || four[3].end >= newestYear.end)) {
    const last = four[3];
    return {
      value: four.reduce((s, q) => s + q.val, 0),
      basis: 'ttm',
      end: last.end,
      form: last.form,
      filed: last.filed,
      accn: last.accn,
      parts: four.map((q) => ({ end: q.end, val: q.val, ...(q.derived ? { derived: true } : {}) })),
    };
  }
  if (newestYear && fresh(newestYear.end)) {
    return { value: newestYear.val, basis: 'annual', end: newestYear.end, form: newestYear.form, filed: newestYear.filed, accn: newestYear.accn };
  }
  return null;
}

// The first concept that yields a recent trailing value, with its currency.
export function trailingOf(facts, concepts, opts = {}) {
  const currencyOf = opts.unit || perShareCurrency;
  for (const [ns, name] of concepts) {
    const units = facts?.[ns]?.[name]?.units;
    if (!units) continue;
    for (const [unit, entries] of Object.entries(units)) {
      const cur = currencyOf(unit);
      if (!cur) continue;
      const t = trailing(periods(entries), opts);
      if (t) return { ...t, currency: cur, concept: `${ns}:${name}` };
    }
  }
  return null;
}

// Shares outstanding from the newest filing that states them. classRule
// (config/share-classes.json) turns each class line into units of the listed
// share: [{ below, ratio }] multiplies a line under `below` by `ratio`
// (Berkshire Class A → 1,500 Class B), divideAll divides every line (Class B
// → Class A units for the BRK-A page).
// The diluted share count of the newest reported period (a quarter, else a
// year): what the income statement divides by. { value, end, form, filed, accn }
export function weightedShares(facts) {
  for (const [ns, name] of WAVG_SHARE_CONCEPTS) {
    const entries = facts?.[ns]?.[name]?.units?.shares;
    if (!entries?.length) continue;
    const ps = periods(entries).filter((p) => p.val > 0 && (isQuarter(p) || isYear(p)));
    if (!ps.length) continue;
    const newest = ps.sort((a, b) => a.end.localeCompare(b.end) || a.len - b.len).at(-1);
    return { value: newest.val, end: newest.end, form: newest.form, filed: newest.filed, accn: newest.accn, concept: `${ns}:${name}` };
  }
  return null;
}

// Shares outstanding: the cover-page count (dei) when it is recent and agrees
// with the income statement's share count within a factor of two; else the
// income statement's diluted count of the newest period. companyfacts drops
// facts tagged per share class, so a multi-class filer (Alphabet, Meta) has
// no cover count at all, and a stale or oddly scaled one (Sony's from 2019,
// Alibaba's a tenth of its ordinary shares) is not used.
export function sharesOutstanding(facts, classRule = null, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const cover = coverShares(facts, classRule);
  const w = weightedShares(facts);
  const wv = w ? unitShares(w.value, classRule) : null;
  const recent = (end) => days(end, asOf) <= 550;
  if (cover && recent(cover.asOf) && (!wv || (cover.value / wv > 0.5 && cover.value / wv < 2))) return cover;
  if (w && recent(w.end)) return { value: Math.round(wv), classes: 1, asOf: w.end, form: w.form, filed: w.filed, accn: w.accn, basis: 'weighted-average' };
  return cover && recent(cover.asOf) ? cover : null;
}

const unitShares = (v, classRule) => {
  let x = v;
  for (const r of classRule?.classes || []) if (v < r.below) x = v * r.ratio;
  return classRule?.divideAll ? x / classRule.divideAll : x;
};

function coverShares(facts, classRule = null) {
  const lines = facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares || [];
  if (!lines.length) return null;
  const newest = lines.reduce((m, e) => (String(e.filed) > String(m.filed) || (e.filed === m.filed && e.end > m.end) ? e : m), lines[0]);
  const same = lines.filter((e) => e.accn === newest.accn && e.end === newest.end && Number.isFinite(e.val) && e.val > 0);
  const value = same.reduce((s, e) => s + unitShares(e.val, classRule), 0);
  if (!(value > 0)) return null;
  return { value: Math.round(value), classes: same.length, asOf: newest.end, form: newest.form, filed: newest.filed, accn: newest.accn };
}

// A company's record for the nightly file. fx: (amount, currency, day) →
// USD or null. adrRatio: home shares per US-listed share (TSM: 5), so EPS
// and the share count are restated per ADS.
export function fundamentalsOf(cf, { cik, classRule = null, fx = null, adrRatio = null, asOf } = {}) {
  const facts = cf?.facts || {};
  const out = { cik: String(cik || cf?.cik || '').padStart(10, '0') };
  const per = adrRatio > 0 ? adrRatio : 1;
  const money = (t, kind) => {
    if (!t) return null;
    let v = t.value;
    if (t.currency !== 'USD') {
      const usd = fx ? fx(v, t.currency, asOf || t.end) : null;
      if (usd == null) return { value: null, reason: `${kind}: ${t.currency} → USD kuru yok`, currency: t.currency, local: t.value, ...src(t, out.cik) };
      v = usd;
    }
    v *= per;
    if (classRule?.epsDivisor && kind === 'eps' && !t.listedUnits) v /= classRule.epsDivisor;
    return { value: Number(v.toFixed(4)), basis: t.basis, currency: t.currency, ...(t.currency !== 'USD' ? { local: t.value } : {}), ...(per !== 1 ? { perAds: per } : {}), ...(t.parts ? { parts: t.parts } : {}), ...src(t, out.cik) };
  };
  let eps = trailingOf(facts, EPS_CONCEPTS, { asOf });
  // no EPS concept: net income over the diluted shares (Berkshire, some 20-F)
  if (!eps) {
    const ni = trailingOf(facts, NET_INCOME_CONCEPTS, { asOf, unit: (u) => (/^[A-Z]{3}$/.test(u) ? u : null) });
    const w = weightedShares(facts);
    if (ni && w?.value > 0 && Math.abs(days(w.end, ni.end)) <= 45) {
      // per the filer's own share units; the class rule's divisor follows
      eps = { ...ni, value: ni.value / w.value, concept: `${ni.concept} ÷ ${w.concept}`, derivedFrom: 'net-income' };
    } else if (ni) {
      // no diluted count either (Berkshire): the cover count, already in the
      // listed share's units, so no class divisor after it
      const cover = sharesOutstanding(facts, classRule, { asOf });
      if (cover?.value > 0 && Math.abs(days(cover.asOf, ni.end)) <= 120) eps = { ...ni, value: ni.value / cover.value, concept: `${ni.concept} ÷ dei:EntityCommonStockSharesOutstanding`, derivedFrom: 'net-income', listedUnits: true };
    }
  }
  out.eps = money(eps, 'eps');
  if (out.eps && eps) {
    out.eps.concept = eps.concept;
    if (eps.derivedFrom) out.eps.derivedFrom = eps.derivedFrom;
  }
  const div = trailingOf(facts, DIV_CONCEPTS, { asOf });
  out.div = money(div, 'div');
  const sh = sharesOutstanding(facts, classRule, { asOf });
  out.shares = sh ? { value: Math.round(sh.value / per), classes: sh.classes, ...(sh.basis ? { basis: sh.basis } : {}), ...(per !== 1 ? { perAds: per } : {}), asOf: sh.asOf, ...src(sh, out.cik) } : null;
  return out;
}

const src = (t, cik) => ({ end: t.end || t.asOf, form: t.form, filed: t.filed, url: filingUrl(cik, t.accn) });

// What the page shows, from the nightly record and the price it has.
//   pe: number, 'loss' (eps ≤ 0) or null · marketCap · dividendYield (a fraction)
export function valuationFor(rec, price) {
  const p = Number(price);
  const ok = Number.isFinite(p) && p > 0;
  const eps = rec?.eps?.value;
  const shares = rec?.shares?.value;
  const div = rec?.div?.value;
  return {
    pe: !ok || eps == null ? null : eps <= 0 ? 'loss' : Number((p / eps).toFixed(2)),
    marketCap: ok && shares > 0 ? Math.round(shares * p) : null,
    dividendYield: ok && div != null && div >= 0 ? Number((div / p).toFixed(5)) : null,
  };
}

// Beta from weekly returns against SPY over two years (104 weeks): the
// covariance over the variance. closes: [{ date, close }] ascending. null
// without 52 common weeks.
export function weeklyBeta(closes, spy, { weeks = 104, asOf = null } = {}) {
  const weekly = (rows) => {
    const m = new Map();
    for (const r of rows || []) {
      if (!r?.date || !(r.close > 0)) continue;
      if (asOf && r.date > asOf) continue;
      // ISO week key: the Friday of the week the close falls in
      const d = new Date(`${r.date}T00:00:00Z`);
      const fri = new Date(d.getTime() + ((5 - d.getUTCDay() + 7) % 7) * DAY).toISOString().slice(0, 10);
      m.set(fri, r.close); // ascending input: the week's last close wins
    }
    return m;
  };
  const a = weekly(closes);
  const b = weekly(spy);
  const keys = [...a.keys()].filter((k) => b.has(k)).sort().slice(-(weeks + 1));
  const ra = [];
  const rb = [];
  for (let i = 1; i < keys.length; i++) {
    ra.push(a.get(keys[i]) / a.get(keys[i - 1]) - 1);
    rb.push(b.get(keys[i]) / b.get(keys[i - 1]) - 1);
  }
  if (ra.length < 52) return null;
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let cov = 0;
  let varb = 0;
  for (let i = 0; i < ra.length; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    varb += (rb[i] - mb) ** 2;
  }
  return varb > 0 ? Number((cov / varb).toFixed(2)) : null;
}

// A filer that re-registered (a new holding company with a new CIK, e.g.
// ExxonMobil Holdings in 2026) keeps its earlier periods under the old CIK:
// the two companyfacts are merged concept by concept, the new one winning a
// period both state (config/predecessors.json).
export function mergeFacts(current, predecessor) {
  if (!predecessor?.facts) return current;
  const out = { ...current, facts: { ...(current?.facts || {}) } };
  for (const [ns, concepts] of Object.entries(predecessor.facts)) {
    out.facts[ns] = { ...(out.facts[ns] || {}) };
    for (const [name, c] of Object.entries(concepts)) {
      const mine = out.facts[ns][name];
      if (!mine) {
        if (ns !== 'dei') out.facts[ns][name] = c;
        continue;
      }
      const units = { ...mine.units };
      for (const [u, entries] of Object.entries(c.units || {})) {
        // the same line from both sources (a filing's document and
        // companyfacts state one cover count) is one line, not two classes
        const key = (e) => `${e.start || ''}|${e.end}|${e.val}|${e.accn}`;
        const have = new Set((units[u] || []).map(key));
        units[u] = [...entries.filter((e) => !have.has(key(e))), ...(units[u] || [])];
      }
      out.facts[ns][name] = { ...mine, units };
    }
  }
  return out;
}
