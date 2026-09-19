// Concentrated, actively-managed funds used for the consensus page.
// Quant giants (Citadel, Millennium, RenTech…), market makers and index-like
// books are excluded on purpose: thousands of algorithmic positions make
// "consensus" meaningless. The bar is a discretionary equity book that stays
// under a few hundred names, so a fund appearing here is a real opinion.
export const CONSENSUS_MANAGERS = [
  { cik: '0001067983', name: 'Berkshire Hathaway' },
  { cik: '0001336528', name: 'Pershing Square' },
  // Deregistered as an investment adviser after its 2025 Q3 report; the
  // 13F dated 2025-11-03 is the last one. Kept for the record, dropped from
  // the panel so a year-old book stops counting as a current opinion.
  { cik: '0001649339', name: 'Scion Asset Management', ceased: '2025-11-03' },
  { cik: '0001536411', name: 'Duquesne Family Office' },
  { cik: '0001656456', name: 'Appaloosa' },
  { cik: '0001040273', name: 'Third Point' },
  // Last 13F under this CIK: 2024-02-14 (2023 Q4). Later reports appear to
  // be filed by a successor entity; until that CIK is confirmed and linked
  // the fund is off the panel rather than voting with a two-year-old book.
  { cik: '0001079114', name: 'Greenlight Capital', ceased: '2024-02-14' },
  { cik: '0001061768', name: 'Baupost Group' },
  { cik: '0001167483', name: 'Tiger Global' },
  { cik: '0001135730', name: 'Coatue Management' },
  { cik: '0001061165', name: 'Lone Pine Capital' },
  { cik: '0001103804', name: 'Viking Global' },
  { cik: '0001029160', name: 'Soros Fund Management' },
  { cik: '0001697748', name: 'ARK Investment Management' },

  // Value and quality
  { cik: '0001166559', name: 'Gates Foundation Trust' },
  { cik: '0001709323', name: 'Himalaya Capital' },
  { cik: '0001759760', name: 'H&H International Investment' },
  { cik: '0001549575', name: 'Dalal Street' },
  { cik: '0000949509', name: 'Oaktree Capital' },
  { cik: '0001056831', name: 'Fairholme Capital' },
  { cik: '0001096343', name: 'Markel Group' },
  { cik: '0001036325', name: 'Davis Selected Advisers' },
  { cik: '0000813917', name: 'Harris Associates' },
  { cik: '0000200217', name: 'Dodge & Cox' },
  { cik: '0000883965', name: 'Weitz Investment Management' },
  { cik: '0000905567', name: 'Yacktman Asset Management' },
  { cik: '0001325447', name: 'First Eagle Investment Management' },
  { cik: '0001720792', name: 'Ruane, Cunniff & Goldfarb' },
  { cik: '0001377581', name: 'First Pacific Advisors' },
  { cik: '0000860643', name: 'Gardner Russo & Quinn' },
  { cik: '0001389403', name: 'Chou Associates' },
  { cik: '0001133219', name: 'Muhlenkamp & Co' },
  { cik: '0001135778', name: 'Miller Value Partners' },
  { cik: '0001039565', name: 'Kahn Brothers Group' },
  { cik: '0001427008', name: 'Smead Capital Management' },
  { cik: '0001641864', name: 'Giverny Capital' },
  { cik: '0001115373', name: 'Semper Augustus Investments' },
  { cik: '0001650135', name: 'Hosking Partners' },
  { cik: '0001505183', name: 'Stockbridge Partners' },
  { cik: '0001953324', name: 'Aquamarine' },
  { cik: '0001631664', name: 'Punch Card Management' },
  { cik: '0001697868', name: 'Valley Forge Capital' },
  { cik: '0001766504', name: 'Greenlea Lane Capital' },
  { cik: '0001766596', name: 'RV Capital' },
  { cik: '0001773994', name: 'Conifer Management' },

  // Growth and quality-growth
  { cik: '0001112520', name: 'Akre Capital Management' },
  { cik: '0001020066', name: 'Sands Capital Management' },
  { cik: '0001034524', name: 'Polen Capital Management' },
  { cik: '0001088875', name: 'Baillie Gifford' },
  { cik: '0001569205', name: 'Fundsmith' },
  { cik: '0001484150', name: 'Lindsell Train' },
  { cik: '0001647251', name: 'TCI Fund Management' },
  { cik: '0001541617', name: 'Altimeter Capital Management' },
  { cik: '0001387322', name: 'Whale Rock Capital Management' },
  { cik: '0001602189', name: 'Dragoneer Investment Group' },
  { cik: '0001569049', name: 'Light Street Capital Management' },
  { cik: '0001798849', name: 'Durable Capital Partners' },
  { cik: '0001581811', name: 'Egerton Capital (UK)' },
  { cik: '0001608485', name: 'Lansdowne Partners (UK)' },
  { cik: '0001353316', name: 'Hound Partners' },
  { cik: '0001592643', name: 'Select Equity Group' },
  { cik: '0001351950', name: 'Findlay Park Partners' },
  { cik: '0001279936', name: 'Cantillon Capital Management' },
  { cik: '0001671657', name: 'Dorsey Asset Management' },

  // Activists
  { cik: '0000921669', name: 'Icahn Capital' },
  { cik: '0001345471', name: 'Trian Fund Management' },
  { cik: '0001517137', name: 'Starboard Value' },
  { cik: '0001998597', name: 'JANA Partners' },
  { cik: '0001418814', name: 'ValueAct Holdings' },
  { cik: '0001582090', name: 'Sachem Head Capital Management' },
  { cik: '0001535472', name: 'Corvex Management' },
  { cik: '0001791786', name: 'Elliott Investment Management' },
  { cik: '0001138995', name: 'Glenview Capital Management' },
];
