// Which trades fall inside the field of a committee the member sits on.
//
// A committee's jurisdiction is matched to the traded company's SEC SIC
// code (the industry code on its EDGAR filings): a member of the Armed
// Services Committee buying an aircraft or guided-missile maker, a Financial
// Services member trading a bank. The match is mechanical — industry code
// against committee — and says nothing about intent or about what the
// member knew; the pages say so next to the flag.
//
// Ranges are inclusive SIC codes. Committees whose work cuts across every
// industry (Appropriations, Budget, Judiciary, Rules, Ethics, Oversight,
// Small Business, the joint committees) have no entry: every trade would
// match and the flag would mean nothing.

const DEFENSE = [
  [3480, 3489, 'ordnance'],
  [3720, 3729, 'aircraft & parts'],
  [3730, 3732, 'shipbuilding'],
  [3760, 3769, 'missiles & space vehicles'],
  [3795, 3795, 'tanks'],
  [3812, 3812, 'defense electronics & navigation'],
];
const DEFENSE_IT = [[7373, 7373, 'government IT & systems integration']];
const BANKING = [
  [6000, 6299, 'banks, lenders & brokers'],
  [6300, 6411, 'insurance'],
  [6700, 6799, 'investment vehicles'],
];
const HEALTH = [
  [2833, 2836, 'drugs & biotech'],
  [3841, 3851, 'medical devices'],
  [5122, 5122, 'drug wholesale'],
  [5912, 5912, 'pharmacies'],
  [6324, 6324, 'health insurance'],
  [8000, 8099, 'health services'],
];
const ENERGY = [
  [1300, 1399, 'oil & gas extraction'],
  [2911, 2911, 'petroleum refining'],
  [4610, 4619, 'pipelines'],
  [4900, 4949, 'electric & gas utilities'],
];
const MINING = [
  [1000, 1299, 'mining'],
  [1400, 1499, 'quarrying'],
  [2400, 2499, 'timber'],
];
const TELECOM_TECH = [
  [3570, 3579, 'computers'],
  [3660, 3679, 'communications equipment & semiconductors'],
  [4800, 4899, 'telecom & media'],
  [7370, 7379, 'software & internet'],
];
const SEMIS_TECH = [
  [3570, 3579, 'computers'],
  [3670, 3679, 'semiconductors & electronics'],
  [7370, 7379, 'software & internet'],
];
const TRANSPORT = [
  [3711, 3716, 'motor vehicles'],
  [3720, 3729, 'aircraft & parts'],
  [3743, 3743, 'railroad equipment'],
  [4000, 4799, 'transportation'],
];
const CONSTRUCTION = [[1600, 1699, 'heavy construction']];
const FARM = [
  [100, 999, 'agriculture'],
  [2000, 2099, 'food processing'],
  [2870, 2879, 'agricultural chemicals'],
  [3523, 3523, 'farm machinery'],
  [5150, 5159, 'farm product wholesale'],
  [6200, 6221, 'commodity brokers & exchanges'],
];
const ENVIRONMENT = [
  [4900, 4949, 'electric & gas utilities'],
  [4950, 4959, 'waste management'],
  [3241, 3241, 'cement'],
];

// committee thomas id → SIC ranges
export const JURISDICTION = {
  // armed services, intelligence, homeland security, foreign affairs (arms sales)
  HSAS: DEFENSE,
  SSAS: DEFENSE,
  HLIG: [...DEFENSE, ...DEFENSE_IT],
  SLIN: [...DEFENSE, ...DEFENSE_IT],
  HSHM: [...DEFENSE, ...DEFENSE_IT],
  SSGA: [...DEFENSE, ...DEFENSE_IT],
  HSFA: DEFENSE,
  SSFR: DEFENSE,
  // banks, securities, insurance
  HSBA: BANKING,
  SSBK: BANKING,
  // tax writers: Medicare and health insurance are theirs too
  HSWM: HEALTH,
  SSFI: HEALTH,
  // health
  SSHR: HEALTH,
  SPAG: HEALTH,
  HSVR: HEALTH,
  SSVA: HEALTH,
  // energy, health, telecom and commerce
  HSIF: [...ENERGY, ...HEALTH, ...TELECOM_TECH],
  SSCM: [...TELECOM_TECH, ...TRANSPORT],
  // energy and natural resources
  SSEG: [...ENERGY, ...MINING],
  HSII: [...ENERGY.filter(([a]) => a < 4900), ...MINING],
  SSEV: [...ENVIRONMENT, ...CONSTRUCTION],
  // transportation
  HSPW: [...TRANSPORT, ...CONSTRUCTION],
  // science and technology
  HSSY: [...SEMIS_TECH, [3760, 3769, 'missiles & space vehicles']],
  HSZS: SEMIS_TECH,
  // agriculture (and the CFTC's commodity markets)
  HSAG: FARM,
  SSAF: FARM,
};

// The industry label a SIC code falls under for a committee, or null.
export function jurisdictionLabel(committee, sic) {
  const code = Number(sic);
  if (!Number.isFinite(code)) return null;
  for (const [lo, hi, label] of JURISDICTION[committee] || []) if (code >= lo && code <= hi) return label;
  return null;
}

// The member's committees whose field the traded company is in.
export const matchingCommittees = (committees, sic) => (committees || []).filter((c) => jurisdictionLabel(c, sic));
