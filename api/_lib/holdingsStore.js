// Read path for the historical store.
//
// The store is optional and, until a backfill has run, empty. Every function
// here answers null when it is not configured or has nothing, and the callers
// fall back to EDGAR exactly as they did before — so the site behaves
// identically before, during and after the backfill, and a store that goes
// down degrades to the old path rather than to an error page.
import axios from 'axios';

const url = () => (process.env.HISTORY_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = () => process.env.HISTORY_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Reading from the store is opt-in: a deployment that has the credentials for
// other reasons (the payment webhook needs the service key) must not start
// routing holdings through a table nobody has filled.
export const storeEnabled = () =>
  process.env.HISTORY_STORE === '1' && Boolean(url() && key());

const headers = () => ({ apikey: key(), Authorization: `Bearer ${key()}` });

async function select(table, params) {
  const r = await axios.get(`${url()}/rest/v1/${table}`, {
    timeout: 8000,
    validateStatus: () => true,
    params,
    headers: headers(),
  });
  if (r.status !== 200) throw new Error(`${table} read HTTP ${r.status}`);
  return r.data || [];
}

// Positions of one filing, in the shape aggregatePositions returns, so a
// caller cannot tell which source answered.
export async function storedHoldings(cik, acc) {
  if (!storeEnabled() || !acc) return null;
  try {
    const rows = await select('holdings', {
      acc: `eq.${acc}`,
      select: 'cusip,put_call,issuer,class,value,shares,weight',
      order: 'value.desc',
    });
    if (!rows.length) return null;
    const positions = rows.map((r) => ({
      cusip: r.cusip,
      putCall: r.put_call || '',
      issuer: r.issuer || '',
      class: r.class || '',
      value: Number(r.value) || 0,
      shares: Number(r.shares) || 0,
      weight: r.weight == null ? 0 : Number(r.weight),
    }));
    return { aum: positions.reduce((s, p) => s + p.value, 0), positions, source: 'store' };
  } catch {
    // any trouble at all: the caller reads EDGAR, which is what it did before
    return null;
  }
}

// Every 13F a filer has made, newest first — the whole history rather than the
// most recent quarters EDGAR's submissions endpoint returns inline.
export async function storedFilings(cik) {
  if (!storeEnabled() || !cik) return null;
  try {
    const rows = await select('filings', {
      cik: `eq.${String(cik).padStart(10, '0')}`,
      select: 'acc,form,amended,report_date,filed,aum,positions',
      order: 'report_date.desc',
      limit: '200',
    });
    if (!rows.length) return null;
    return rows.map((r) => ({
      acc: r.acc,
      form: r.form,
      amended: r.amended,
      reportDate: r.report_date,
      filingDate: r.filed,
      aum: r.aum == null ? null : Number(r.aum),
      positions: r.positions,
    }));
  } catch {
    return null;
  }
}

// How far the backfill has got, for the status line on an admin page or a job
// log. Null when the store is off or the job has never run.
export async function backfillState(job = '13f') {
  if (!storeEnabled()) return null;
  try {
    const rows = await select('backfill_state', { job: `eq.${job}`, select: '*' });
    return rows[0] || null;
  } catch {
    return null;
  }
}
