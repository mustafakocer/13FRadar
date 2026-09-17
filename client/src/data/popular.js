// Curated well-known 13F filers (CIK numbers from SEC EDGAR).
// style: value | growth | activist | macro | quant — shown as a friendly badge.
//
// history: false marks a filer whose info table is too wide to backfill forty
// quarters of (the market makers and multi-strats file 2k–14k names a quarter;
// scripts/build-guru-history.mjs would spend the whole CI budget on them).
// They stay browsable — only the ten-year history is skipped. Never set it on
// a filer that already has stored history: the next run would drop it.
export const POPULAR_MANAGERS = [
  { cik: '0001067983', name: 'Berkshire Hathaway (Warren Buffett)', style: 'value' },
  { cik: '0001350694', name: 'Bridgewater Associates (Ray Dalio)', style: 'macro' },
  { cik: '0001336528', name: 'Pershing Square (Bill Ackman)', style: 'activist' },
  { cik: '0001649339', name: 'Scion Asset Management (Michael Burry)', style: 'value' },
  { cik: '0001037389', name: 'Renaissance Technologies', style: 'quant' },
  { cik: '0001536411', name: 'Duquesne Family Office (Druckenmiller)', style: 'macro' },
  { cik: '0001656456', name: 'Appaloosa (David Tepper)', style: 'macro' },
  { cik: '0001040273', name: 'Third Point (Dan Loeb)', style: 'activist' },
  { cik: '0001079114', name: 'Greenlight Capital (David Einhorn)', style: 'value' },
  { cik: '0001061768', name: 'Baupost Group (Seth Klarman)', style: 'value' },
  { cik: '0001167483', name: 'Tiger Global Management', style: 'growth' },
  { cik: '0001135730', name: 'Coatue Management', style: 'growth' },
  { cik: '0001061165', name: 'Lone Pine Capital', style: 'growth' },
  { cik: '0001103804', name: 'Viking Global Investors', style: 'growth' },
  { cik: '0001423053', name: 'Citadel Advisors (Ken Griffin)', style: 'quant' },
  { cik: '0001273087', name: 'Millennium Management', style: 'quant' },
  { cik: '0001009207', name: 'D.E. Shaw & Co', style: 'quant' },
  { cik: '0001179392', name: 'Two Sigma Investments', style: 'quant' },
  { cik: '0001029160', name: 'Soros Fund Management', style: 'macro' },
  { cik: '0001697748', name: 'ARK Investment Management (Cathie Wood)', style: 'growth' },

  // Value and quality
  { cik: '0001166559', name: 'Gates Foundation Trust (Bill Gates)', style: 'value' },
  { cik: '0001709323', name: 'Himalaya Capital (Li Lu)', style: 'value' },
  { cik: '0001759760', name: 'H&H International Investment (Duan Yongping)', style: 'value' },
  { cik: '0001549575', name: 'Dalal Street (Mohnish Pabrai)', style: 'value' },
  { cik: '0000949509', name: 'Oaktree Capital (Howard Marks)', style: 'value' },
  { cik: '0001056831', name: 'Fairholme Capital (Bruce Berkowitz)', style: 'value' },
  { cik: '0001096343', name: 'Markel Group (Tom Gayner)', style: 'value' },
  { cik: '0001036325', name: 'Davis Selected Advisers (Chris Davis)', style: 'value' },
  { cik: '0000813917', name: 'Harris Associates (Bill Nygren)', style: 'value' },
  { cik: '0000200217', name: 'Dodge & Cox', style: 'value' },
  { cik: '0000883965', name: 'Weitz Investment Management', style: 'value' },
  { cik: '0000905567', name: 'Yacktman Asset Management', style: 'value' },
  { cik: '0001325447', name: 'First Eagle Investment Management', style: 'value' },
  { cik: '0001720792', name: 'Ruane, Cunniff & Goldfarb', style: 'value' },
  { cik: '0001377581', name: 'First Pacific Advisors (Steven Romick)', style: 'value' },
  { cik: '0001352662', name: 'GMO (Jeremy Grantham)', style: 'value' },
  { cik: '0000860643', name: 'Gardner Russo & Quinn (Tom Russo)', style: 'value' },
  { cik: '0001389403', name: 'Chou Associates (Francis Chou)', style: 'value' },
  { cik: '0001133219', name: 'Muhlenkamp & Co', style: 'value' },
  { cik: '0001135778', name: 'Miller Value Partners (Bill Miller)', style: 'value' },
  { cik: '0001039565', name: 'Kahn Brothers Group', style: 'value' },
  { cik: '0001427008', name: 'Smead Capital Management', style: 'value' },
  { cik: '0001641864', name: 'Giverny Capital', style: 'value' },
  { cik: '0001115373', name: 'Semper Augustus Investments', style: 'value' },
  { cik: '0001650135', name: 'Hosking Partners', style: 'value' },
  { cik: '0001505183', name: 'Stockbridge Partners', style: 'value' },
  { cik: '0001953324', name: 'Aquamarine (Guy Spier)', style: 'value' },
  { cik: '0001631664', name: 'Punch Card Management (Norbert Lou)', style: 'value' },
  { cik: '0001697868', name: 'Valley Forge Capital (Dev Kantesaria)', style: 'value' },
  { cik: '0001766504', name: 'Greenlea Lane Capital (Josh Tarasoff)', style: 'value' },
  { cik: '0001766596', name: 'RV Capital (Robert Vinall)', style: 'value' },
  { cik: '0001773994', name: 'Conifer Management (Greg Alexander)', style: 'value' },

  // Growth and quality-growth
  { cik: '0001112520', name: 'Akre Capital Management', style: 'growth' },
  { cik: '0001020066', name: 'Sands Capital Management', style: 'growth' },
  { cik: '0001034524', name: 'Polen Capital Management', style: 'growth' },
  { cik: '0001088875', name: 'Baillie Gifford', style: 'growth' },
  { cik: '0001569205', name: 'Fundsmith (Terry Smith)', style: 'growth' },
  { cik: '0001484150', name: 'Lindsell Train (Nick Train)', style: 'growth' },
  { cik: '0001647251', name: 'TCI Fund Management (Chris Hohn)', style: 'growth' },
  { cik: '0001541617', name: 'Altimeter Capital Management', style: 'growth' },
  { cik: '0001387322', name: 'Whale Rock Capital Management', style: 'growth' },
  { cik: '0001602189', name: 'Dragoneer Investment Group', style: 'growth' },
  { cik: '0001569049', name: 'Light Street Capital Management', style: 'growth' },
  { cik: '0001798849', name: 'Durable Capital Partners', style: 'growth' },
  { cik: '0001581811', name: 'Egerton Capital (UK)', style: 'growth' },
  { cik: '0001608485', name: 'Lansdowne Partners (UK)', style: 'growth' },
  { cik: '0001353316', name: 'Hound Partners', style: 'growth' },
  { cik: '0001592643', name: 'Select Equity Group', style: 'growth' },
  { cik: '0001351950', name: 'Findlay Park Partners', style: 'growth' },
  { cik: '0001279936', name: 'Cantillon Capital Management', style: 'growth' },
  { cik: '0001671657', name: 'Dorsey Asset Management', style: 'growth' },
  { cik: '0001422848', name: 'Capital Research Global Investors', style: 'growth' },

  // Activists
  { cik: '0000921669', name: 'Icahn Capital (Carl Icahn)', style: 'activist' },
  { cik: '0001345471', name: 'Trian Fund Management (Nelson Peltz)', style: 'activist' },
  { cik: '0001517137', name: 'Starboard Value', style: 'activist' },
  { cik: '0001998597', name: 'JANA Partners', style: 'activist' },
  { cik: '0001418814', name: 'ValueAct Holdings', style: 'activist' },
  { cik: '0001582090', name: 'Sachem Head Capital Management', style: 'activist' },
  { cik: '0001535472', name: 'Corvex Management', style: 'activist' },
  { cik: '0001791786', name: 'Elliott Investment Management', style: 'activist' },
  { cik: '0001138995', name: 'Glenview Capital Management', style: 'activist' },
  { cik: '0000807249', name: 'GAMCO Investors (Mario Gabelli)', style: 'activist', history: false },

  // Macro and event-driven
  { cik: '0001425851', name: 'Pentwater Capital Management', style: 'macro' },
  { cik: '0001610880', name: 'BlueCrest Capital Management', style: 'macro' },
  { cik: '0001512857', name: 'Brevan Howard Capital Management', style: 'macro', history: false },

  // Quants, multi-strats and market makers — wide books, history skipped
  { cik: '0000850529', name: 'Fisher Asset Management (Ken Fisher)', style: 'quant', history: false },
  { cik: '0001167557', name: 'AQR Capital Management (Cliff Asness)', style: 'quant', history: false },
  { cik: '0001510387', name: 'Gotham Asset Management (Joel Greenblatt)', style: 'quant', history: false },
  { cik: '0001318757', name: 'Marshall Wace', style: 'quant', history: false },
  { cik: '0001603466', name: 'Point72 Asset Management (Steve Cohen)', style: 'quant', history: false },
  { cik: '0001218710', name: 'Balyasny Asset Management', style: 'quant', history: false },
  { cik: '0001665241', name: 'Schonfeld Strategic Advisors', style: 'quant', history: false },
  { cik: '0001446194', name: 'Susquehanna International Group', style: 'quant', history: false },
  { cik: '0001595888', name: 'Jane Street Group', style: 'quant', history: false },
  { cik: '0001164508', name: 'Arrowstreet Capital', style: 'quant', history: false },
  { cik: '0000916542', name: 'Acadian Asset Management', style: 'quant', history: false },
  { cik: '0001453072', name: 'Alyeska Investment Group', style: 'quant' },
  { cik: '0000080255', name: 'T. Rowe Price Associates', style: 'growth', history: false },
  { cik: '0000902219', name: 'Wellington Management Group', style: 'growth', history: false },
];

export const managerStyle = (cik) => POPULAR_MANAGERS.find((m) => m.cik === cik)?.style || null;

// Filers whose ten-year history is worth precomputing (see the note above).
export const wantsHistory = (cik) => POPULAR_MANAGERS.find((m) => m.cik === cik)?.history !== false;
