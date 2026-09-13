import { fmtMoney } from './format.js';

// "Answer box" — the one plain-data paragraph rendered under every entity H1
// (and reused as JSON-LD description, meta description and llms-full.txt).
// Pure functions over normalized inputs so the SSR pages, the build scripts
// and the tests all produce identical text.

const longDate = (iso, lang) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const quarterOf = (iso, lang) => {
  if (!iso) return '';
  const [y, m] = iso.split('-').map(Number);
  const q = Math.ceil(m / 3);
  return lang === 'tr' ? `${y} Q${q}` : `Q${q} ${y}`;
};
const pct = (v) => (v == null ? '' : `${Number(v).toFixed(1)}%`);
const num = (n, lang) => (n == null ? '' : Number(n).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US'));

// Sentence-level helpers ---------------------------------------------------
const MOVE = {
  en: { new: 'new buy', add: 'add', reduce: 'reduce', exit: 'exit' },
  tr: { new: 'yeni alım', add: 'artırma', reduce: 'azaltma', exit: 'çıkış' },
};

// Biggest move among a manager's quarter-over-quarter changes: the largest
// dollar amount across new buys, adds, reduces and exits.
export function biggestMove({ newBuys = [], adds = [], reduces = [], exits = [] }) {
  const cands = [
    ...newBuys.map((r) => ({ kind: 'new', ...r })),
    ...adds.map((r) => ({ kind: 'add', ...r })),
    ...reduces.map((r) => ({ kind: 'reduce', ...r })),
    ...exits.map((r) => ({ kind: 'exit', ...r })),
  ].filter((r) => r.value > 0);
  cands.sort((a, b) => b.value - a.value);
  return cands[0] || null;
}

// Derive changes from the free-tier page data (top-10 vs. previous quarter).
export function movesFromPositions(positions = [], prevPositions = null) {
  if (!prevPositions) return { newBuys: [], adds: [], reduces: [], exits: [] };
  const prev = new Map(prevPositions.map((p) => [p.cusip, p]));
  const cur = new Map(positions.map((p) => [p.cusip, p]));
  const out = { newBuys: [], adds: [], reduces: [], exits: [] };
  for (const p of positions) {
    const q = prev.get(p.cusip);
    const px = p.shares > 0 ? p.value / p.shares : 0;
    if (!q) out.newBuys.push({ ticker: p.ticker, issuer: p.issuer, value: p.value });
    else if (p.shares > q.shares) out.adds.push({ ticker: p.ticker, issuer: p.issuer, value: (p.shares - q.shares) * px });
    else if (p.shares < q.shares) out.reduces.push({ ticker: p.ticker, issuer: p.issuer, value: (q.shares - p.shares) * px });
  }
  for (const q of prevPositions) if (!cur.has(q.cusip)) out.exits.push({ ticker: q.ticker, issuer: q.issuer, value: q.value });
  return out;
}

// Guru ----------------------------------------------------------------------
// input: { name, firm, count, aum, reportDate, filingDate, top: {ticker, issuer, weight}, move: {kind, ticker, issuer, value} }
export function guruAnswer(input, lang = 'en') {
  const { name, firm, count, aum, reportDate, filingDate, top, move } = input;
  if (!name || count == null || aum == null || !reportDate) return null;
  const firmPart = firm && firm !== name ? ` (${firm})` : '';
  const topSym = top ? top.ticker || top.issuer : null;
  const moveSym = move ? move.ticker || move.issuer : null;
  if (lang === 'tr') {
    let s = `${name}${firmPart}, ${longDate(reportDate, lang)} itibarıyla ${num(count, lang)} pozisyon ve ${fmtMoney(aum)} portföy değeri bildirdi (13F bildirimi ${longDate(filingDate, lang) || '—'}).`;
    if (topSym) s += ` En büyük pozisyon: ${topSym} (${pct(top.weight)}).`;
    if (moveSym) s += ` En büyük hamle: ${MOVE.tr[move.kind]} ${moveSym} (${fmtMoney(move.value)}).`;
    return s;
  }
  let s = `${name}${firmPart} reported ${num(count, lang)} positions worth ${fmtMoney(aum)} as of ${longDate(reportDate, lang)} (13F filed ${longDate(filingDate, lang) || '—'}).`;
  if (topSym) s += ` Largest holding: ${topSym} (${pct(top.weight)}).`;
  if (moveSym) s += ` Biggest move: ${MOVE.en[move.kind]} ${moveSym} (${fmtMoney(move.value)}).`;
  return s;
}

// Adapter for the guru page (manager + holdings + previous quarter, or the
// precomputed consensus `updates` card when the manager is curated).
export function guruAnswerFromPage({ manager, filing, holdings, prevPositions, update }, lang) {
  if (!manager || !filing || !holdings?.positions?.length) return null;
  const top = holdings.positions[0];
  const moves = update
    ? { newBuys: update.newBuys, adds: update.adds, reduces: update.reduces, exits: update.exits }
    : movesFromPositions(holdings.positions.slice(0, 10), prevPositions);
  return guruAnswer(
    {
      name: manager.displayName || manager.name,
      firm: manager.name,
      count: holdings.count ?? holdings.positions.length,
      aum: holdings.aum,
      reportDate: filing.reportDate,
      filingDate: filing.filingDate,
      top: { ticker: top.ticker, issuer: top.issuer, weight: top.weight },
      move: biggestMove(moves),
    },
    lang
  );
}

// Adapter for precomputed data (llms-full.txt, related blocks): guru-history
// quarter + consensus update card.
export function guruAnswerFromHistory({ name, firm, history, update, tickerOf = () => null }, lang) {
  const q = history?.quarters?.[history.quarters.length - 1];
  if (!q) return null;
  const topCusip = q.top10?.[0];
  const topEntry = history.positions?.[topCusip] || null;
  const latest = topEntry?.series?.[topEntry.series.length - 1];
  return guruAnswer(
    {
      name,
      firm,
      count: q.count,
      aum: q.aum,
      reportDate: q.reportDate,
      filingDate: q.filed,
      top: topCusip ? { ticker: topEntry?.ticker || tickerOf(topCusip) || (/^[A-Z0-9.-]{1,6}$/.test(topCusip) ? topCusip : null), issuer: topEntry?.issuer || topCusip, weight: latest?.[3] } : null,
      move: update ? biggestMove(update) : null,
    },
    lang
  );
}

// Stock ---------------------------------------------------------------------
// input: { company, ticker, holderCount, totalValue, reportDate, buyers, sellers, netValue, topHolder: {name, weight}, filers }
export function stockAnswer(input, lang = 'en') {
  const { company, ticker, holderCount, totalValue, reportDate, buyers, sellers, netValue, topHolder, price, currency, marketCap } = input;
  if (!company || !ticker) return null;
  // Outside the tracked set there is no ownership number worth stating, so the
  // answer says that plainly and falls back to the quote rather than counting
  // EDGAR search hits, which said more about who files often than who owns it.
  if (holderCount == null) {
    const quote = [
      price != null ? `${lang === 'tr' ? 'Fiyat' : 'Price'} ${price.toFixed(2)} ${currency || 'USD'}` : null,
      marketCap ? `${lang === 'tr' ? 'piyasa değeri' : 'market cap'} ${fmtMoney(marketCap)}` : null,
    ].filter(Boolean).join('; ');
    return lang === 'tr'
      ? `${company} (${ticker}) hissesi, takip edilen usta yatırımcı setinin en çok tutulan 30 hissesi arasında değil.${quote ? ` ${quote}.` : ''}`
      : `${company} (${ticker}) is not among the 30 most-held stocks of the tracked superinvestor set.${quote ? ` ${quote}.` : ''}`;
  }
  const q = quarterOf(reportDate, lang);
  if (lang === 'tr') {
    let s = `${company} (${ticker}) hissesi, ${q} itibarıyla takip edilen ${num(holderCount, lang)} usta yatırımcı tarafından toplam ${fmtMoney(totalValue)} değerinde tutuluyor.`;
    s += ` ${num(buyers || 0, lang)} fon artırdı, ${num(sellers || 0, lang)} fon azalttı; net akış ${fmtMoney(netValue || 0)}.`;
    if (topHolder) s += ` En büyük sahip: ${topHolder.name} (portföyünün ${pct(topHolder.weight)}'i).`;
    return s;
  }
  let s = `${company} (${ticker}) is held by ${num(holderCount, lang)} tracked superinvestors worth ${fmtMoney(totalValue)} as of ${q}.`;
  s += ` ${num(buyers || 0, lang)} increased, ${num(sellers || 0, lang)} reduced; net flow ${fmtMoney(netValue || 0)}.`;
  if (topHolder) s += ` Largest holder: ${topHolder.name} (${pct(topHolder.weight)} of their portfolio).`;
  return s;
}

export function stockAnswerFromPage({ ticker, company, consensusRow, reportDate, quote }, lang) {
  if (!company || !ticker) return null;
  if (!consensusRow)
    return stockAnswer(
      { company, ticker, price: quote?.price, currency: quote?.currency, marketCap: quote?.marketCap },
      lang
    );
  const top = consensusRow.holders?.[0];
  return stockAnswer(
    {
      company,
      ticker,
      holderCount: consensusRow.holderCount,
      totalValue: consensusRow.totalValue,
      reportDate,
      buyers: consensusRow.buyers,
      sellers: consensusRow.sellers,
      netValue: consensusRow.netValue,
      topHolder: top ? { name: top.name, weight: top.weight } : null,
    },
    lang
  );
}

// Ranking -------------------------------------------------------------------
export const RANK_RULE = {
  en: {
    'most-bought': 'ranked by net dollar value bought (adds and new positions minus reductions) across the tracked superinvestor set',
    'most-sold': 'ranked by net dollar value sold across the tracked superinvestor set',
    consensus: 'ranked by the number of tracked superinvestors holding the stock',
    conviction: 'ranked by the average portfolio weight among the superinvestors that hold the stock (at least two holders)',
  },
  tr: {
    'most-bought': 'takip edilen usta yatırımcı setinde net alım tutarına göre (artırma ve yeni pozisyonlar eksi azaltmalar) sıralanır',
    'most-sold': 'takip edilen usta yatırımcı setinde net satış tutarına göre sıralanır',
    consensus: 'hisseyi tutan usta yatırımcı sayısına göre sıralanır',
    conviction: 'hisseyi tutan usta yatırımcıların ortalama portföy ağırlığına göre sıralanır (en az iki sahip)',
  },
};
export const RANK_NAME = {
  en: { 'most-bought': 'Most bought', 'most-sold': 'Most sold', consensus: 'Consensus', conviction: 'High conviction' },
  tr: { 'most-bought': 'En çok alınanlar', 'most-sold': 'En çok satılanlar', consensus: 'Konsensüs', conviction: 'Yüksek kanaat' },
};

export function rankingAnswer({ kind, reportDate, first, managers }, lang = 'en') {
  if (!first || !reportDate) return null;
  const q = quarterOf(reportDate, lang);
  const sym = first.ticker || first.issuer;
  const n = managers ? ` (${num(managers, lang)} ${lang === 'tr' ? 'fon' : 'funds'})` : '';
  const stat =
    kind === 'most-bought' ? fmtMoney(first.netValue)
    : kind === 'most-sold' ? fmtMoney(Math.abs(first.netValue))
    : kind === 'consensus' ? `${num(first.holderCount, lang)} ${lang === 'tr' ? 'fon' : 'holders'}`
    : pct(first.avgWeight);
  return lang === 'tr'
    ? `${RANK_NAME.tr[kind]} listesi ${q} 13F bildirimlerine dayanır${n} ve ${RANK_RULE.tr[kind]}; 1. sıra: ${sym} (${stat}).`
    : `${RANK_NAME.en[kind]} is based on ${q} 13F filings${n}, ${RANK_RULE.en[kind]}; #1: ${sym} (${stat}).`;
}

// Meta description: whole sentences that fit in 155 characters.
export function truncate155(text) {
  if (!text) return '';
  if (text.length <= 155) return text;
  const cut = text.slice(0, 155);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return end > 60 ? cut.slice(0, end + 1) : `${cut.slice(0, 152).trimEnd()}…`;
}
