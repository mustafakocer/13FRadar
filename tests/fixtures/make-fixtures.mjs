// Deterministic offline fixtures for SSR tests: three filers with two
// quarters each, three tickers, holders for the matching names/CUSIPs.
// Values are synthetic (rounded, clearly not real filings) — they exercise
// the rendering path, not the data.
import fs from 'node:fs';
import path from 'node:path';

const out = path.join(path.dirname(new URL(import.meta.url).pathname), 'sec');
const w = (rel, body) => {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof body === 'string' ? body : JSON.stringify(body));
};

const STOCKS = {
  AAPL: ['037833100', 'APPLE INC', 'Apple Inc.', 225.5],
  AMZN: ['023135106', 'AMAZON COM INC', 'Amazon.com, Inc.', 190.2],
  MSFT: ['594918104', 'MICROSOFT CORP', 'Microsoft Corporation', 420.1],
  GOOGL: ['02079K305', 'ALPHABET INC', 'Alphabet Inc.', 165.3],
  NVDA: ['67066G104', 'NVIDIA CORPORATION', 'NVIDIA Corporation', 118.9],
  OXY: ['674599105', 'OCCIDENTAL PETE CORP', 'Occidental Petroleum Corporation', 60.4],
  BAC: ['060505104', 'BANK OF AMER CORP', 'Bank of America Corporation', 40.7],
  CVX: ['166764100', 'CHEVRON CORP NEW', 'Chevron Corporation', 150.2],
  KO: ['191216100', 'COCA COLA CO', 'The Coca-Cola Company', 65.1],
  AXP: ['025816109', 'AMERICAN EXPRESS CO', 'American Express Company', 245.6],
  CMG: ['169656105', 'CHIPOTLE MEXICAN GRILL INC', 'Chipotle Mexican Grill, Inc.', 55.3],
  HLT: ['43300A203', 'HILTON WORLDWIDE HLDGS INC', 'Hilton Worldwide Holdings Inc.', 220.9],
  BABA: ['01609W102', 'ALIBABA GROUP HLDG LTD', 'Alibaba Group Holding Limited', 85.4],
};

const FILERS = [
  { cik: '0001067983', name: 'BERKSHIRE HATHAWAY INC', city: 'OMAHA', state: 'NE',
    q: [['0000950123-26-008001', '2026-08-14', '2026-06-30'], ['0000950123-26-005001', '2026-05-15', '2026-03-31']],
    cur: [['AAPL', 300e6, 69.9e9], ['AXP', 151.6e6, 37.2e9], ['BAC', 605e6, 24.6e9], ['KO', 400e6, 26e9], ['CVX', 118e6, 17.7e9], ['OXY', 264e6, 15.9e9], ['GOOGL', 20e6, 3.3e9], ['AMZN', 10e6, 1.9e9], ['NVDA', 5e6, 0.6e9], ['MSFT', 2e6, 0.84e9], ['HLT', 1e6, 0.22e9]],
    prev: [['AAPL', 400e6, 80e9], ['AXP', 151.6e6, 36e9], ['BAC', 1000e6, 38e9], ['KO', 400e6, 25e9], ['CVX', 123e6, 18e9], ['OXY', 255e6, 15e9], ['AMZN', 10e6, 1.8e9], ['MSFT', 2e6, 0.8e9], ['CMG', 3e6, 0.18e9]] },
  { cik: '0001336528', name: 'PERSHING SQUARE CAPITAL MANAGEMENT, L.P.', city: 'NEW YORK', state: 'NY',
    q: [['0001104659-26-090001', '2026-08-14', '2026-06-30'], ['0001104659-26-060001', '2026-05-15', '2026-03-31']],
    cur: [['GOOGL', 12e6, 2.0e9], ['CMG', 28e6, 1.55e9], ['HLT', 7e6, 1.5e9], ['AMZN', 6e6, 1.1e9], ['MSFT', 2.4e6, 1.0e9]],
    prev: [['GOOGL', 12e6, 1.9e9], ['CMG', 28e6, 1.5e9], ['HLT', 8e6, 1.6e9], ['AMZN', 4e6, 0.7e9]] },
  { cik: '0001649339', name: 'SCION ASSET MANAGEMENT, LLC', city: 'SARATOGA', state: 'CA',
    q: [['0001649339-26-000004', '2026-08-13', '2026-06-30'], ['0001649339-26-000002', '2026-05-14', '2026-03-31']],
    cur: [['BABA', 1.5e6, 128e6], ['NVDA', 0.5e6, 59e6], ['OXY', 1e6, 60e6]],
    prev: [['BABA', 2e6, 160e6], ['KO', 0.3e6, 20e6]] },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const infoTable = (rows) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">\n` +
  rows
    .map(([t, shares, value]) => {
      const [cusip, issuer] = STOCKS[t];
      return `  <infoTable><nameOfIssuer>${esc(issuer)}</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>${cusip}</cusip><value>${Math.round(value)}</value><shrsOrPrnAmt><sshPrnamt>${Math.round(shares)}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion><votingAuthority><Sole>${Math.round(shares)}</Sole><Shared>0</Shared><None>0</None></votingAuthority></infoTable>`;
    })
    .join('\n') +
  `\n</informationTable>\n`;

for (const f of FILERS) {
  w(`submissions/CIK${f.cik}.json`, {
    cik: String(Number(f.cik)), name: f.name,
    addresses: { business: { city: f.city, stateOrCountry: f.state } },
    filings: { recent: {
      form: f.q.map(() => '13F-HR'),
      accessionNumber: f.q.map((x) => x[0]),
      filingDate: f.q.map((x) => x[1]),
      reportDate: f.q.map((x) => x[2]),
    } },
  });
  const cikN = String(Number(f.cik));
  w(`filings/${cikN}/${f.q[0][0].replace(/-/g, '')}/infotable.xml`, infoTable(f.cur));
  w(`filings/${cikN}/${f.q[1][0].replace(/-/g, '')}/infotable.xml`, infoTable(f.prev));
}

for (const [sym, [cusip, issuer, name, px]] of Object.entries(STOCKS)) {
  w(`stock/${sym}.json`, {
    source: 'quoteSummary',
    price: { symbol: sym, name, currency: 'USD', price: px, change: 1.2, changePercent: 0.53, open: px - 1, high: px + 2, low: px - 2, prevClose: px - 1.2, volume: 50e6, marketCap: px * 4e9, high52: px * 1.3, low52: px * 0.7 },
    valuation: { trailingPE: 28.4, forwardPE: 25.1, peg: 2.1, priceToSales: 7.5, priceToBook: 30.2, evToEbitda: 21.3, evToRevenue: 7.2, enterpriseValue: px * 4.1e9, bookValue: 4.1 },
    fundamentals: { revenue: 380e9, revenueGrowth: 0.06, earningsGrowth: 0.1, grossMargin: 0.45, operatingMargin: 0.3, profitMargin: 0.25, ebitda: 130e9, roe: 1.4, roa: 0.22, debtToEquity: 150, currentRatio: 0.95, quickRatio: 0.85, totalCash: 60e9, totalDebt: 100e9, freeCashflow: 100e9, operatingCashflow: 110e9, dividendYield: 0.005, dividendRate: 1.0 },
    profile: { sector: 'Technology', industry: 'Consumer Electronics', summary: `${name} fixture profile.`, employees: 160000, website: 'https://example.com' },
    income: [], balance: [], cashflow: [], earnings: [],
    history: { ret1y: 20.1, retYtd: 8.4, ret1d: 0.53 },
  });
  const holders = FILERS.filter((f) => f.cur.some((r) => r[0] === sym)).map((f) => ({ cik: f.cik, name: f.name, filings: 8 }));
  const payload = { total: holders.length * 137, holders };
  w(`holders/${cusip}.json`, payload);
  w(`holders/${name.replace(/\.$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, payload);
}
console.log('fixtures written to', out);
