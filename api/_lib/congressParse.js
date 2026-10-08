// Parsers for the two official STOCK Act sources. Pure functions: no I/O,
// so the tests run them on recorded filings.
//
//   House  — disclosures-clerk.house.gov
//            <YEAR>FD.zip holds <YEAR>FD.xml, one <Member> per filing;
//            FilingType P is a Periodic Transaction Report (PTR). Each PTR
//            is a PDF at /public_disc/ptr-pdfs/<YEAR>/<DocID>.pdf. E-filed
//            PDFs carry real text laid out as a table; paper filings are
//            scans with no text and are recorded without transactions.
//   Senate — efdsearch.senate.gov (a Django app behind a DataTables
//            endpoint). E-filed PTRs are HTML pages with one <table>;
//            paper filings (/search/view/paper/) are images.
//
// A transaction comes out as
//   { d: 'YYYY-MM-DD' trade date, t: ticker|null, a: asset name,
//     at: asset type (stock|option|etf|fund|bond|crypto|other),
//     k: 'buy'|'sell'|'sell_partial'|'exchange'|'other',
//     o: 'self'|'spouse'|'joint'|'child', lo, hi: dollar range (hi null for "Over") }

// ------------------------------------------------------------ shared

const MONTH_DAY_YEAR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
export function isoDate(s) {
  const m = MONTH_DAY_YEAR.exec(String(s || '').trim());
  if (!m) return null;
  const [, mo, d, y] = m;
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

// "$1,001 - $15,000" → {lo:1001, hi:15000}; "Over $50,000,000" → {lo:50000001, hi:null}
export function parseAmount(s) {
  const text = String(s || '').replace(/\s+/g, ' ').trim();
  const nums = (text.match(/\$?\d[\d,]*/g) || []).map((x) => Number(x.replace(/[$,]/g, ''))).filter((n) => n > 0);
  if (!nums.length) return { lo: null, hi: null };
  if (/over|\+|more than/i.test(text) && nums.length === 1) return { lo: nums[0] + 1, hi: null };
  if (nums.length === 1) return { lo: nums[0], hi: nums[0] };
  return { lo: nums[0], hi: nums[nums.length - 1] };
}

// The dollar figure a range stands for: its midpoint (an "Over" range: the floor).
export const amountMid = (r) => (r.lo == null ? null : r.hi == null ? r.lo : (r.lo + r.hi) / 2);

const TICKER = /^[A-Z][A-Z0-9]{0,5}(?:[.\-/][A-Z0-9]{1,2})?$/;
export function cleanTicker(s) {
  const t = String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\//g, '.');
  if (!t || t === '--' || t === 'N/A' || !TICKER.test(t)) return null;
  return t;
}

// House asset-type codes (fd.house.gov/reference/asset-type-codes.aspx) and
// the Senate's spelled-out types, folded into a few buckets.
const HOUSE_TYPES = { ST: 'stock', OP: 'option', EF: 'etf', MF: 'fund', CS: 'bond', GS: 'bond', AB: 'bond', CT: 'crypto', OT: 'other', PS: 'stock', SA: 'other', OL: 'other' };
export function houseAssetType(code) {
  return HOUSE_TYPES[String(code || '').toUpperCase()] || (code ? 'other' : 'other');
}
export function senateAssetType(s) {
  const t = String(s || '').toLowerCase();
  if (/option/.test(t)) return 'option';
  if (/non-public/.test(t)) return 'other';
  if (/stock/.test(t)) return 'stock';
  if (/etf|exchange traded/.test(t)) return 'etf';
  if (/mutual fund|fund/.test(t)) return 'fund';
  if (/bond|municipal|treasury|government|note/.test(t)) return 'bond';
  if (/crypto/.test(t)) return 'crypto';
  return 'other';
}

export function houseKind(s) {
  const t = String(s || '').trim().toUpperCase();
  if (t === 'P') return 'buy';
  if (/^S\s*\(PARTIAL\)$/.test(t)) return 'sell_partial';
  if (t === 'S' || /^S\s*\(FULL\)$/.test(t)) return 'sell';
  if (t === 'E') return 'exchange';
  return 'other';
}
export function senateKind(s) {
  const t = String(s || '').toLowerCase();
  if (/purchase/.test(t)) return 'buy';
  if (/sale/.test(t) && /partial/.test(t)) return 'sell_partial';
  if (/sale/.test(t)) return 'sell';
  if (/exchange/.test(t)) return 'exchange';
  return 'other';
}

export function owner(s) {
  const t = String(s || '').trim().toLowerCase();
  if (!t || t === 'self' || t === '--') return 'self';
  if (t === 'sp' || /spouse/.test(t)) return 'spouse';
  if (t === 'jt' || /joint/.test(t)) return 'joint';
  if (t === 'dc' || /child|dependent/.test(t)) return 'child';
  return 'self';
}

// ------------------------------------------------------------ House index

const tag = (block, name) => {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(block);
  return m ? decode(m[1]).trim() : '';
};
const decode = (s) =>
  String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

// Every PTR in a year's FD.xml.
export function parseHouseIndex(xml) {
  const out = [];
  for (const block of String(xml).split('<Member>').slice(1)) {
    if (tag(block, 'FilingType') !== 'P') continue;
    const docId = tag(block, 'DocID');
    const filed = isoDate(tag(block, 'FilingDate'));
    if (!docId || !filed) continue;
    out.push({
      docId,
      year: Number(tag(block, 'Year')) || Number(filed.slice(0, 4)),
      prefix: tag(block, 'Prefix'),
      first: tag(block, 'First'),
      last: tag(block, 'Last'),
      suffix: tag(block, 'Suffix'),
      stateDst: tag(block, 'StateDst').toUpperCase(),
      filed,
    });
  }
  return out;
}

export const housePdfUrl = (year, docId) => `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${docId}.pdf`;

// ------------------------------------------------------------ House PTR PDF

// pdf.js text items → lines, top to bottom, each item {x, s}. Items within
// 2.5pt of the same baseline are one line; empty strings are dropped.
export function linesFromItems(items) {
  const rows = [];
  for (const it of items) {
    const s = String(it.str ?? it.s ?? '');
    if (!s.trim()) continue;
    const x = it.transform ? it.transform[4] : it.x;
    const y = it.transform ? it.transform[5] : it.y;
    let row = rows.find((r) => Math.abs(r.y - y) <= 2.5);
    if (!row) rows.push((row = { y, items: [] }));
    row.items.push({ x, s });
  }
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

// The PDF's section labels are drawn in a font pdf.js cannot map, so they
// come out as a capital and NULs ("F\0\0\0\0\0 S\0\0\0\0\0: New" is
// "Filing Status: New"). A line carrying one is detail under a row.
const isLabel = (s) => s.includes('\u0000');
const cleanText = (s) => s.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();

// The table's columns from its header line ("ID Owner Asset Transaction
// Date Notification Amount Cap."). Returns cut points between columns.
function headerColumns(line) {
  const at = (word, after = -Infinity) => line.items.find((i) => cleanText(i.s) === word && i.x > after)?.x;
  const asset = at('Asset');
  const type = at('Transaction');
  const amount = at('Amount');
  if (asset == null || type == null || amount == null) return null;
  const date = at('Date', type);
  const notif = at('Notification');
  const ownerX = at('Owner');
  const cap = at('Cap.') ?? amount + 80;
  if (date == null || notif == null) return null;
  const pad = 4;
  return {
    owner: [(ownerX ?? asset - 40) - 12, asset - pad],
    asset: [asset - pad, type - pad],
    type: [type - pad, date - pad],
    date: [date - pad, notif - pad],
    notif: [notif - pad, amount - pad],
    amount: [amount - pad, cap - pad],
  };
}

const inCol = (cols, name, x) => x >= cols[name][0] && x < cols[name][1];
const colText = (cols, name, line) =>
  cleanText(
    line.items
      .filter((i) => inCol(cols, name, i.x))
      .map((i) => i.s)
      .join(' '),
  );

// Asset text "Chevron Corporation Common Stock (CVX) [ST]" → parts.
export function splitHouseAsset(text) {
  const t = cleanText(text);
  const code = (t.match(/\[([A-Z]{2})\]\s*$/) || t.match(/\[([A-Z]{2})\]/) || [])[1] || null;
  const tickers = [...t.matchAll(/\(([A-Z][A-Z0-9.\-]{0,9})\)/g)].map((m) => m[1]);
  const ticker = cleanTicker(tickers[tickers.length - 1]);
  const name = cleanText(
    t
      .replace(/\[[A-Z]{2}\]/g, '')
      .replace(ticker ? new RegExp(`\\(${ticker.replace(/[.\-]/g, '\\$&')}\\)`) : /$^/, ''),
  ).replace(/\s*-\s*$/, '');
  return { name, ticker, code };
}

// pages: array of line arrays (linesFromItems per page).
// Returns { tx: [...], name, stateDst, text: boolean } — text false means
// the PDF had no table text (a scanned paper filing).
export function parseHousePtr(pages) {
  const tx = [];
  let cols = null;
  let cur = null;
  let detail = false;
  let sawText = false;
  let name = '';
  let stateDst = '';
  const flush = () => {
    if (!cur) return;
    const parts = splitHouseAsset(cur.asset);
    const amt = parseAmount(cur.amount);
    const d = isoDate(cur.date);
    if (d && parts.name) {
      tx.push({
        d,
        t: parts.code && !['ST', 'OP', 'EF', 'PS'].includes(parts.code) ? null : parts.ticker,
        a: parts.name,
        at: houseAssetType(parts.code),
        k: houseKind(cur.type),
        o: owner(cur.owner),
        lo: amt.lo,
        hi: amt.hi,
      });
    }
    cur = null;
  };
  for (const lines of pages) {
    let ended = false;
    for (const line of lines) {
      const all = line.items.map((i) => i.s).join(' ');
      if (all.trim()) sawText = true;
      const plain = cleanText(all);
      if (/^Name:/.test(plain)) name = plain.replace(/^Name:\s*/, '');
      if (/^State\/District:/.test(plain)) stateDst = plain.replace(/^State\/District:\s*/, '').toUpperCase();
      const header = headerColumns(line);
      if (header) {
        cols = header;
        continue;
      }
      if (!cols) continue;
      if (/asset type abbreviations/i.test(plain) || /^I CERTIFY/.test(plain) || /^Digitally Signed/.test(plain)) {
        flush();
        ended = true;
        break;
      }
      const date = colText(cols, 'date', line);
      if (isoDate(date)) {
        flush();
        detail = false;
        cur = {
          owner: colText(cols, 'owner', line),
          asset: colText(cols, 'asset', line),
          type: colText(cols, 'type', line),
          date,
          amount: colText(cols, 'amount', line),
        };
        continue;
      }
      if (!cur) continue;
      if (line.items.some((i) => isLabel(i.s))) {
        detail = true;
        continue;
      }
      const amountMore = colText(cols, 'amount', line);
      if (amountMore && /-\s*$/.test(cur.amount)) cur.amount += ' ' + amountMore;
      if (!detail) {
        const more = colText(cols, 'asset', line);
        if (more) cur.asset += ' ' + more;
        const typeMore = colText(cols, 'type', line);
        if (typeMore && /^S$/i.test(cur.type) && /^\(partial\)$/i.test(typeMore)) cur.type += ' ' + typeMore;
      }
    }
    if (!ended) flush();
    else cur = null;
    // a later page continues the table with the same columns
  }
  flush();
  return { tx, name, stateDst, text: sawText };
}

// ------------------------------------------------------------ Senate

export const SENATE_BASE = 'https://efdsearch.senate.gov';

// One DataTables row: [first, last, "Last, First (Senator)", link html, "MM/DD/YYYY"]
export function parseSenateIndexRow(row) {
  if (!Array.isArray(row) || row.length < 5) return null;
  const href = (/href="([^"]+)"/.exec(row[3]) || [])[1];
  const filed = isoDate(row[4]);
  if (!href || !filed) return null;
  const id = href.replace(/\/+$/, '').split('/').pop();
  return {
    id,
    first: cleanText(String(row[0])).replace(/[ ,]+$/, ''),
    last: cleanText(String(row[1])).replace(/[ ,]+$/, ''),
    filer: cleanText(String(row[2])),
    title: cleanText(String(row[3]).replace(/<[^>]+>/g, '')),
    filed,
    url: SENATE_BASE + href,
    paper: href.includes('/view/paper/'),
    amendment: /amendment/i.test(String(row[3])),
  };
}

const stripTags = (s) => decode(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// The transaction table of an e-filed Senate PTR page.
// Columns: #, Transaction Date, Owner, Ticker, Asset Name, Asset Type, Type, Amount, Comment
export function parseSenatePtr(html) {
  const s = String(html);
  const start = s.indexOf('<tbody');
  if (start < 0) return [];
  const body = s.slice(start, s.indexOf('</tbody>', start));
  const tx = [];
  for (const rowHtml of body.split(/<tr[\s>]/).slice(1)) {
    const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (cells.length < 8) continue;
    const d = isoDate(stripTags(cells[1]));
    if (!d) continue;
    // the asset cell carries detail lines in <div>s (coupon, maturity, company)
    const assetName = stripTags(cells[4].split(/<div/)[0]);
    const amt = parseAmount(stripTags(cells[7]));
    const at = senateAssetType(stripTags(cells[5]));
    tx.push({
      d,
      t: at === 'stock' || at === 'option' || at === 'etf' ? cleanTicker(stripTags(cells[3])) : null,
      a: assetName,
      at,
      k: senateKind(stripTags(cells[6])),
      o: owner(stripTags(cells[2])),
      lo: amt.lo,
      hi: amt.hi,
    });
  }
  return tx;
}
