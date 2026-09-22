// The superinvestor registry — the one list every page, endpoint and build
// counts from.
//
// There used to be two: client/src/data/popular.js (the ~100 chips on the
// home page, with a `style` badge and a `history` opt-out) and
// api/_lib/consensusList.js (the ~72 discretionary books the consensus is
// computed over). They overlapped, drifted, and every page counted a
// different one: the consensus said "72 funds", the calendar "82/100", the
// home page showed ~100 chips, and /report — built from the history set, a
// third selection — quoted the consensus count under numbers computed over
// 85 funds. Both files now re-export from here.
//
// Fields:
//   cik, name          EDGAR CIK (10 digits) and the display name
//   category           value | growth | quant | activist | macro |
//                      multi-strategy | family-office | other
//   activeFrom         first period of report tracked (null = since the
//                      fund's first 13F in the look-back)
//   activeTo           last period of report the fund filed for; null while
//                      it is still filing. A closed fund is *not* removed:
//                      its history stays, its pages stay, it just stops
//                      counting as tracked
//   successor          the CIK that carries the book now (Greenlight → DME)
//   consensus: false   a wide, systematic or multi-manager book that would
//                      make "consensus" meaningless (thousands of
//                      algorithmic positions). Tracked, browsable, but not a
//                      vote in the net-activity aggregation
//   history: false     an info table too wide to backfill forty quarters of
//                      (market makers, multi-strats: 2k–14k names a quarter)
//
// Categories were assigned from public descriptions of each firm; the ones
// that do not fit a single style are `other` and listed by `uncategorised()`
// so they can be reviewed rather than guessed at.

const G = (cik, name, category, extra = {}) => ({ cik, name, category, ...extra });

export const CATEGORIES = ['value', 'growth', 'quant', 'activist', 'macro', 'multi-strategy', 'family-office', 'other'];

export const GURUS = [
  G('0001067983', 'Berkshire Hathaway (Warren Buffett)', 'value'),
  G('0001350694', 'Bridgewater Associates (Ray Dalio)', 'macro', { consensus: false }),
  G('0001336528', 'Pershing Square (Bill Ackman)', 'activist'),
  // Deregistered as an adviser after the 2025 Q3 report; no further 13Fs.
  G('0001649339', 'Scion Asset Management (Michael Burry)', 'value', { activeTo: '2025-09-30' }),
  G('0001037389', 'Renaissance Technologies', 'quant', { consensus: false }),
  G('0001536411', 'Duquesne Family Office (Druckenmiller)', 'family-office'),
  G('0001656456', 'Appaloosa (David Tepper)', 'macro'),
  G('0001040273', 'Third Point (Dan Loeb)', 'activist'),
  // Einhorn's 13Fs moved from Greenlight Capital Inc to DME Capital
  // Management, LP with the 2024 Q1 report. The old CIK keeps its page and
  // its ten years of history; the new one carries the current book.
  G('0001489933', 'DME Capital Management (Greenlight, David Einhorn)', 'value', { activeFrom: '2024-03-31' }),
  G('0001079114', 'Greenlight Capital Inc (David Einhorn, to 2023)', 'value', { activeTo: '2023-12-31', successor: '0001489933' }),
  G('0001061768', 'Baupost Group (Seth Klarman)', 'value'),
  G('0001167483', 'Tiger Global Management', 'growth'),
  G('0001135730', 'Coatue Management', 'growth'),
  G('0001061165', 'Lone Pine Capital', 'growth'),
  G('0001103804', 'Viking Global Investors', 'growth'),
  G('0001423053', 'Citadel Advisors (Ken Griffin)', 'multi-strategy', { consensus: false }),
  G('0001273087', 'Millennium Management', 'multi-strategy', { consensus: false }),
  G('0001009207', 'D.E. Shaw & Co', 'quant', { consensus: false }),
  G('0001179392', 'Two Sigma Investments', 'quant', { consensus: false }),
  G('0001029160', 'Soros Fund Management', 'family-office'),
  G('0001697748', 'ARK Investment Management (Cathie Wood)', 'growth'),

  // Value and quality
  G('0001166559', 'Gates Foundation Trust (Bill Gates)', 'other'),
  G('0001709323', 'Himalaya Capital (Li Lu)', 'value'),
  G('0001759760', 'H&H International Investment (Duan Yongping)', 'family-office'),
  G('0001549575', 'Dalal Street (Mohnish Pabrai)', 'value'),
  G('0000949509', 'Oaktree Capital (Howard Marks)', 'other'),
  G('0001056831', 'Fairholme Capital (Bruce Berkowitz)', 'value'),
  G('0001096343', 'Markel Group (Tom Gayner)', 'other'),
  G('0001036325', 'Davis Selected Advisers (Chris Davis)', 'value'),
  G('0000813917', 'Harris Associates (Bill Nygren)', 'value'),
  G('0000200217', 'Dodge & Cox', 'value'),
  G('0000883965', 'Weitz Investment Management', 'value'),
  G('0000905567', 'Yacktman Asset Management', 'value'),
  G('0001325447', 'First Eagle Investment Management', 'value'),
  G('0001720792', 'Ruane, Cunniff & Goldfarb', 'value'),
  G('0001377581', 'First Pacific Advisors (Steven Romick)', 'value'),
  G('0001352662', 'GMO (Jeremy Grantham)', 'value', { consensus: false }),
  G('0000860643', 'Gardner Russo & Quinn (Tom Russo)', 'value'),
  G('0001389403', 'Chou Associates (Francis Chou)', 'value'),
  G('0001133219', 'Muhlenkamp & Co', 'value'),
  G('0001135778', 'Miller Value Partners (Bill Miller)', 'value'),
  G('0001039565', 'Kahn Brothers Group', 'value'),
  G('0001427008', 'Smead Capital Management', 'value'),
  G('0001641864', 'Giverny Capital', 'value'),
  G('0001115373', 'Semper Augustus Investments', 'value'),
  G('0001650135', 'Hosking Partners', 'value'),
  G('0001505183', 'Stockbridge Partners', 'other'),
  G('0001953324', 'Aquamarine (Guy Spier)', 'value'),
  G('0001631664', 'Punch Card Management (Norbert Lou)', 'value'),
  G('0001697868', 'Valley Forge Capital (Dev Kantesaria)', 'value'),
  G('0001766504', 'Greenlea Lane Capital (Josh Tarasoff)', 'value'),
  G('0001766596', 'RV Capital (Robert Vinall)', 'value'),
  G('0001773994', 'Conifer Management (Greg Alexander)', 'value'),

  // Growth and quality-growth
  G('0001112520', 'Akre Capital Management', 'growth'),
  G('0001020066', 'Sands Capital Management', 'growth'),
  G('0001034524', 'Polen Capital Management', 'growth'),
  G('0001088875', 'Baillie Gifford', 'growth'),
  G('0001569205', 'Fundsmith (Terry Smith)', 'growth'),
  G('0001484150', 'Lindsell Train (Nick Train)', 'growth'),
  G('0001647251', 'TCI Fund Management (Chris Hohn)', 'growth'),
  G('0001541617', 'Altimeter Capital Management', 'growth'),
  G('0001387322', 'Whale Rock Capital Management', 'growth'),
  G('0001602189', 'Dragoneer Investment Group', 'growth'),
  G('0001569049', 'Light Street Capital Management', 'growth'),
  G('0001798849', 'Durable Capital Partners', 'growth'),
  G('0001581811', 'Egerton Capital (UK)', 'growth'),
  G('0001608485', 'Lansdowne Partners (UK)', 'growth'),
  G('0001353316', 'Hound Partners', 'growth'),
  G('0001592643', 'Select Equity Group', 'growth'),
  G('0001351950', 'Findlay Park Partners', 'growth'),
  G('0001279936', 'Cantillon Capital Management', 'growth'),
  G('0001671657', 'Dorsey Asset Management', 'growth'),
  G('0001422848', 'Capital Research Global Investors', 'growth', { consensus: false }),

  // Activists
  G('0000921669', 'Icahn Capital (Carl Icahn)', 'activist'),
  G('0001345471', 'Trian Fund Management (Nelson Peltz)', 'activist'),
  G('0001517137', 'Starboard Value', 'activist'),
  G('0001998597', 'JANA Partners', 'activist'),
  G('0001418814', 'ValueAct Holdings', 'activist'),
  G('0001582090', 'Sachem Head Capital Management', 'activist'),
  G('0001535472', 'Corvex Management', 'activist'),
  G('0001791786', 'Elliott Investment Management', 'activist'),
  G('0001138995', 'Glenview Capital Management', 'activist'),
  G('0000807249', 'GAMCO Investors (Mario Gabelli)', 'value', { consensus: false, history: false }),

  // Macro and event-driven
  G('0001425851', 'Pentwater Capital Management', 'other', { consensus: false }),
  G('0001610880', 'BlueCrest Capital Management', 'macro', { consensus: false }),
  G('0001512857', 'Brevan Howard Capital Management', 'macro', { consensus: false, history: false }),

  // Quants, multi-strats and market makers — wide books, history skipped
  G('0000850529', 'Fisher Asset Management (Ken Fisher)', 'other', { consensus: false, history: false }),
  G('0001167557', 'AQR Capital Management (Cliff Asness)', 'quant', { consensus: false, history: false }),
  G('0001510387', 'Gotham Asset Management (Joel Greenblatt)', 'quant', { consensus: false, history: false }),
  G('0001318757', 'Marshall Wace', 'quant', { consensus: false, history: false }),
  G('0001603466', 'Point72 Asset Management (Steve Cohen)', 'multi-strategy', { consensus: false, history: false }),
  G('0001218710', 'Balyasny Asset Management', 'multi-strategy', { consensus: false, history: false }),
  G('0001665241', 'Schonfeld Strategic Advisors', 'multi-strategy', { consensus: false, history: false }),
  G('0001446194', 'Susquehanna International Group', 'quant', { consensus: false, history: false }),
  G('0001595888', 'Jane Street Group', 'quant', { consensus: false, history: false }),
  G('0001164508', 'Arrowstreet Capital', 'quant', { consensus: false, history: false }),
  G('0000916542', 'Acadian Asset Management', 'quant', { consensus: false, history: false }),
  G('0001453072', 'Alyeska Investment Group', 'multi-strategy', { consensus: false }),
  G('0000080255', 'T. Rowe Price Associates', 'growth', { consensus: false, history: false }),
  G('0000902219', 'Wellington Management Group', 'other', { consensus: false, history: false }),
];

const byCik = new Map(GURUS.map((g) => [g.cik, g]));
export const guruByCik = (cik) => byCik.get(String(cik).replace(/\D/g, '').padStart(10, '0')) || null;
export const isGuru = (cik) => byCik.has(String(cik).replace(/\D/g, '').padStart(10, '0'));

// Whether a fund was filing for a given period of report (YYYY-MM-DD, a
// quarter end). With no period: whether it is filing now.
export function isActive(g, quarterEnd = null) {
  if (!g) return false;
  if (!quarterEnd) return !g.activeTo;
  if (g.activeFrom && quarterEnd < g.activeFrom) return false;
  if (g.activeTo && quarterEnd > g.activeTo) return false;
  return true;
}

// "Tracked": every fund filing now (or in the given period).
export const activeGurus = (quarterEnd = null) => GURUS.filter((g) => isActive(g, quarterEnd));
// The consensus panel: discretionary books, filing in the period.
export const consensusPanel = (quarterEnd = null) => activeGurus(quarterEnd).filter((g) => g.consensus !== false);
// The funds whose ten-year history is precomputed (closed ones included:
// their history is exactly what a closed fund's page has to show).
export const historyPanel = () => GURUS.filter((g) => g.history !== false);
export const wantsHistory = (cik) => guruByCik(cik)?.history !== false;
export const uncategorised = () => GURUS.filter((g) => g.category === 'other');

// The badge on a fund page. Categories the i18n table has no word for fall
// back to the nearest badge; `other` shows none.
const STYLE = { value: 'value', growth: 'growth', activist: 'activist', macro: 'macro', quant: 'quant', 'multi-strategy': 'multi-strategy', 'family-office': 'family-office' };
export const managerStyle = (cik) => STYLE[guruByCik(cik)?.category] || null;

// The reasons a tracked fund is not in the panel for a period, so a page
// can say "100 tracked, 82 filed, 72 counted — 10 not filed, 18 wide books"
// instead of three different numbers.
//   filedByCik: Map cik → latest period of report known for the fund
export function coverage(quarterEnd, filedByCik = new Map()) {
  const tracked = activeGurus(quarterEnd);
  const reasons = { 'not-filed': 0, 'wide-book': 0 };
  let filed = 0;
  let included = 0;
  for (const g of tracked) {
    const hasFiled = filedByCik.get(g.cik) === quarterEnd;
    if (hasFiled) filed++;
    if (hasFiled && g.consensus !== false) {
      included++;
      continue;
    }
    const why = g.consensus === false ? 'wide-book' : 'not-filed';
    reasons[why] = (reasons[why] || 0) + 1;
  }
  return { quarter: quarterEnd, tracked: tracked.length, filed, included, excluded: reasons };
}
