import axios from 'axios';
import { needsLookup, record, tickerFor, retryQueue, stats } from './securityMaster.js';

// OpenFIGI transport for the security master (securityMaster.js). Nothing
// here is consulted at request time: the master answers instantly from the
// committed table, and only the builds — which have a key and no deadline —
// call OpenFIGI for identifiers the master does not know, writing the
// answer (or the failure) back into it.
//
// Without OPENFIGI_API_KEY: 10 jobs/request & 25 req/min; with a free key:
// 100/request.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A 13F identifier that starts with a letter is a CINS — the CUSIP-format
// number a non-US issuer gets (Spotify L868…, ASML N070…, Linde G549…).
// OpenFIGI files those under their own id type and answers nothing for them
// as a CUSIP, which is how every foreign-domiciled name in the table sat
// without a ticker.
export const figiIdType = (id) => (/^[A-Za-z]/.test(String(id)) ? 'ID_CINS' : 'ID_CUSIP');

// ---- ISIN derivation -------------------------------------------------------
// An ISIN is a two-letter country code, the national identifier padded to
// nine characters, and a Luhn check digit computed over the letters spelled
// as numbers (A=10 … Z=35). For a US CUSIP the national identifier is the
// CUSIP itself (Apple 037833100 → US0378331005); for a CINS the same holds
// under the issuer's country of registration (Marvell G5876H105 →
// BMG5876H1051). The CINS prefix letter says the region, not the country,
// so several country codes are tried (G: Bermuda, Cayman, UK, Ireland, the
// Channel Islands…); Swiss and Dutch ISINs are built on other national
// numbers and rarely match, which is why this is the last resort, after
// ID_CINS and ID_CUSIP both failed.
export function isinCheckDigit(base) {
  const digits = [];
  for (const ch of String(base).toUpperCase()) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) digits.push(code - 48);
    else if (code >= 65 && code <= 90) for (const d of String(code - 55)) digits.push(Number(d));
    else return null;
  }
  let sum = 0;
  let double = true; // rightmost digit is doubled
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

export function cusipToIsin(cusip, country) {
  const c = String(cusip || '').toUpperCase();
  const cc = String(country || '').toUpperCase();
  if (!/^[A-Z0-9]{9}$/.test(c) || !/^[A-Z]{2}$/.test(cc)) return null;
  const check = isinCheckDigit(cc + c);
  return check == null ? null : `${cc}${c}${check}`;
}

// CINS prefix letter → the country codes an ISIN for that issuer could carry.
const CINS_COUNTRIES = {
  A: ['AT'],
  B: ['AU', 'BE'],
  C: ['CA'],
  D: ['DE'],
  E: ['ES'],
  F: ['FR'],
  G: ['BM', 'KY', 'GB', 'IE', 'JE', 'GG', 'VG', 'IM'],
  H: ['CH'],
  J: ['JP'],
  K: ['DK'],
  L: ['LU'],
  M: ['IL'],
  N: ['NL'],
  P: ['PA', 'BR', 'AR', 'CL', 'CO', 'PE'],
  Q: ['AU'],
  R: ['NO'],
  S: ['ZA'],
  T: ['IT'],
  U: ['US'],
  V: ['MU'],
  W: ['SE'],
  X: ['FI', 'PT', 'GR'],
  Y: ['HK', 'SG', 'TW', 'KR', 'CN', 'IN'],
};

export function isinCandidates(cusip) {
  const c = String(cusip || '').toUpperCase();
  if (!/^[A-Z0-9]{9}$/.test(c)) return [];
  const countries = /^[A-Z]/.test(c) ? CINS_COUNTRIES[c[0]] || [] : ['US'];
  return countries.map((cc) => cusipToIsin(c, cc)).filter(Boolean);
}

// ---- transport -------------------------------------------------------------
const best = (hits) => hits.find((d) => d.exchCode === 'US' && d.ticker) || hits.find((d) => d.ticker) || null;
const shape = (d) => (d ? { ticker: d.ticker, name: d.name || null, exchange: d.exchCode || null, figi: d.figi || null } : null);

// One POST to /v3/mapping: jobs is [{ idType, idValue }]. Answers an array
// aligned with jobs, each { ticker, name, exchange, figi } or null; null for
// the whole batch when the request itself failed.
export async function openfigiLookup(jobs, { key = process.env.OPENFIGI_API_KEY, http = axios } = {}) {
  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      const r = await http.post('https://api.openfigi.com/v3/mapping', jobs, {
        timeout: 15000,
        validateStatus: () => true,
        headers: { 'Content-Type': 'application/json', ...(key ? { 'X-OPENFIGI-APIKEY': key } : {}) },
      });
      if (r.status === 429) {
        await sleep(1500 * attempts);
        continue;
      }
      if (r.status !== 200 || !Array.isArray(r.data)) return null;
      return r.data.map((res) => shape(best(res?.data || [])));
    } catch {
      await sleep(1000 * attempts);
    }
  }
  return null;
}

// Resolve identifiers into the master: CINS/CUSIP first, ID_CUSIP again for
// a CINS OpenFIGI files that way, then the derived ISINs. Bounded by
// `maxLive` identifiers per call. `names` ({ cusip: issuer }) lets an
// unresolved entry remember the issuer the filing carried.
export async function resolveIntoMaster(cusips, { maxLive = 60, names = {}, key = process.env.OPENFIGI_API_KEY, http = axios } = {}) {
  const batchSize = key ? 100 : 10;
  const need = needsLookup(cusips).slice(0, maxLive);
  if (!need.length) return { looked: 0, resolved: 0 };
  let resolved = 0;
  const pending = new Set(need);
  // identifiers OpenFIGI answered (with a hit or an empty result); a request
  // that failed outright leaves its identifiers unasked, with no attempt
  // recorded against them
  const asked = new Set();

  const round = async (idType, ids, valueOf = (c) => c) => {
    for (let i = 0; i < ids.length; i += batchSize) {
      const slice = ids.slice(i, i + batchSize);
      const jobs = slice.map((c) => ({ idType, idValue: valueOf(c) }));
      const out = await openfigiLookup(jobs, { key, http });
      if (!out) continue; // the request failed: leave them pending, no attempt recorded
      out.forEach((hit, j) => {
        const c = slice[j];
        asked.add(c);
        if (!pending.has(c)) return;
        if (hit?.ticker) {
          record(c, hit, { source: idType === 'ID_ISIN' ? 'isin' : 'openfigi', name: names[c] });
          pending.delete(c);
          resolved++;
        }
      });
      if (!key && i + batchSize < ids.length) await sleep(2600);
    }
  };

  // 1. the id type the identifier's own format says
  const cins = need.filter((c) => figiIdType(c) === 'ID_CINS');
  const plain = need.filter((c) => figiIdType(c) === 'ID_CUSIP');
  await round('ID_CINS', cins);
  await round('ID_CUSIP', plain);
  // 2. a CINS that OpenFIGI files as a CUSIP after all
  await round('ID_CUSIP', cins.filter((c) => pending.has(c)));
  // 3. the ISINs the identifier could stand for
  const isinJobs = [];
  for (const c of [...pending]) for (const isin of isinCandidates(c)) isinJobs.push({ c, isin });
  for (let i = 0; i < isinJobs.length; i += batchSize) {
    const slice = isinJobs.slice(i, i + batchSize);
    const out = await openfigiLookup(slice.map((j) => ({ idType: 'ID_ISIN', idValue: j.isin })), { key, http });
    if (!out) continue;
    out.forEach((hit, j) => {
      const { c } = slice[j];
      asked.add(c);
      if (!pending.has(c) || !hit?.ticker) return;
      record(c, hit, { source: 'isin', name: names[c] });
      pending.delete(c);
      resolved++;
    });
  }
  // whatever is left was asked about and not answered
  for (const c of pending) if (asked.has(c)) record(c, null, { name: names[c] });
  return { looked: need.length, resolved };
}

// The call every consumer makes: { cusip: ticker|null } for the identifiers
// given, from the master, resolving at most `maxLive` unknown ones first.
export async function mapCusipsToTickers(cusips, { maxLive = 60, names = {} } = {}) {
  const list = [...new Set((cusips || []).map((c) => String(c || '').toUpperCase()).filter(Boolean))];
  if (maxLive > 0) {
    try {
      await resolveIntoMaster(list, { maxLive, names });
    } catch {
      /* the master still answers what it knows */
    }
  }
  const out = {};
  for (const c of cusips || []) out[c] = tickerFor(c);
  return out;
}

// The daily retry of identifiers OpenFIGI could not map, bounded.
export async function retryUnresolved({ limit = 200 } = {}) {
  const due = retryQueue({ limit });
  if (!due.length) return { due: 0, resolved: 0, ...stats() };
  const r = await resolveIntoMaster(due, { maxLive: due.length });
  return { due: due.length, ...r, ...stats() };
}
