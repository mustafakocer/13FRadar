// Curated well-known 13F filers (CIK numbers from SEC EDGAR).
// style: value | growth | activist | macro | quant — shown as a friendly badge.
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
];

export const managerStyle = (cik) => POPULAR_MANAGERS.find((m) => m.cik === cik)?.style || null;
