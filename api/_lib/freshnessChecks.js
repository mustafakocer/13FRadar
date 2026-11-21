// Is every dataset the site serves actually current? Pure: a `read(file)`
// function in, a verdict per dataset out; scripts/check-freshness.mjs prints
// it and turns the workflow red, tests/freshness.test.mjs pins the rules.
//
// Every check looks at a date INSIDE the data — the newest filing, the newest
// price, the quarter covered — never at when the file was written and never
// at a crawl checkpoint. The insider feed sat on 2026-09-18 for nine days
// while its file was rewritten every morning and its checkpoint claimed
// 2026-09-25; both kinds of date said "fresh".
//
// A dataset with no date of its own (guru cards, related managers) is tied to
// the run of the dataset it is built with (`derivedFrom`), whose own date is
// checked. The split table has no market date either, but it does carry the
// day each ticker was last re-checked against the provider, and that is what
// is judged: it was rewritten unchanged every night for seven weeks while
// the provider refused every request, and its write time said "ok".
import { businessDaysBehind, dataFreshness, isoDay } from '../../client/src/lib/secCalendar.js';
import { recheckSpan } from './splitsRun.js';

const DAY = 86400000;
// the shelf life of a return row (stockMetaBuild.js RETURNS_MAX_AGE_DAYS;
// repeated here so this module stays free of the build's imports)
const RETURNS_ROW_MAX_AGE_DAYS = 7;
// how long the Senate site may refuse the build before the alarm speaks
export const SENATE_BLOCK_MAX_DAYS = 3;
// The split job runs every night and re-checks SPLITS_BUDGET tickers (60),
// oldest check first, so on any healthy night the newest re-check is that
// night. Three days leaves room for a weekend of late or failed runs.
export const SPLITS_RECHECK_MAX_DAYS = 3;
// One pass over the queue takes tickers ÷ budget nights (about 3,300 ÷ 60 =
// 55 today). A ticker whose last check is twice that old means the rotation
// is stuck on part of the list.
export const SPLITS_ROTATION_MAX_DAYS = 120;
const maxOf = (list) => list.reduce((m, v) => (v && v > m ? v : m), '') || null;

// The newest quarter whose 13F deadline (45 days after quarter end) passed at
// least `graceDays` ago: the quarter a current consensus must cover.
export function expectedQuarter(now = Date.now(), graceDays = 10) {
  const d = new Date(now);
  for (let y = d.getUTCFullYear(); y >= d.getUTCFullYear() - 1; y--) {
    for (const q of ['12-31', '09-30', '06-30', '03-31']) {
      const end = `${y}-${q}`;
      if (Date.parse(`${end}T00:00:00Z`) + (45 + graceDays) * DAY <= now) return end;
    }
  }
  return null;
}

// A date that must be at most `maxBehind` SEC business days behind today.
const businessDate = (label, date, maxBehind, now) => {
  if (!date) return { ok: false, detail: `${label}: no date in the data` };
  const behind = businessDaysBehind(date, isoDay(now));
  return {
    ok: behind <= maxBehind,
    detail: `${label} ${date} (${behind} business day(s) behind, limit ${maxBehind})`,
  };
};

const quarterDate = (label, quarter, now) => {
  const want = expectedQuarter(now);
  if (!quarter) return { ok: false, detail: `${label}: no quarter in the data` };
  return { ok: !want || quarter >= want, detail: `${label} ${quarter} (expected ≥ ${want})` };
};

// The split table, by the re-check days inside it (splitsRun.js).
export function judgeSplits(table, now) {
  const { count, newest, oldest } = recheckSpan(table);
  const tickers = Object.keys(table?.byTicker || {}).length;
  if (!count) return { ok: false, detail: `no ticker has been re-checked (0 of ${tickers}); table content last changed ${table?.dataChangedAt ?? '—'}` };
  const ageOf = (day) => Math.floor((now - Date.parse(`${day}T00:00:00Z`)) / DAY);
  const newestAge = ageOf(newest);
  const oldestAge = ageOf(oldest);
  if (newestAge > SPLITS_RECHECK_MAX_DAYS) return { ok: false, detail: `newest re-check ${newest} (${newestAge}d, limit ${SPLITS_RECHECK_MAX_DAYS}d); ${count} of ${tickers} tickers ever re-checked` };
  if (oldestAge > SPLITS_ROTATION_MAX_DAYS) return { ok: false, detail: `oldest re-check ${oldest} (${oldestAge}d, limit ${SPLITS_ROTATION_MAX_DAYS}d) — the rotation is not reaching every ticker` };
  return { ok: true, detail: `newest re-check ${newest}, oldest ${oldest}; ${count} of ${tickers} tickers re-checked` };
}

// the newest date among a foreign-exchange table's series ({ CUR: [[day, rate], …] })
const newestRate = (rates) => maxOf(Object.values(rates || {}).map((series) => (Array.isArray(series) && series.length ? series[series.length - 1]?.[0] : null)));

// label, file, and how to judge it
export const CHECKS = [
  {
    label: 'insider transactions',
    file: 'api/_data/insiders.json',
    // the newest filing date among current rows — the same rule as the badge
    judge: (j, now) => {
      const rows = Array.isArray(j?.rows) ? j.rows.filter((r) => !r.sb) : [];
      const f = dataFreshness(maxOf(rows.map((r) => r.f)), now);
      return { ok: f.live, detail: `newest filing ${f.lastDay ?? '—'} (${f.behind ?? '?'} business day(s) behind, limit 1)` };
    },
  },
  {
    label: 'insider teaser (public)',
    file: 'client/public/insiders-teaser.json',
    judge: (j, now) => {
      const f = dataFreshness(j?.lastDay, now);
      return { ok: f.live, detail: `newest filing ${f.lastDay ?? '—'} (${f.behind ?? '?'} business day(s) behind, limit 1)` };
    },
  },
  {
    label: 'congress trades',
    file: 'api/_data/congress.json',
    // members file within 45 days of a trade and the chambers publish every
    // business day; a week with no new report means the build is stuck
    judge: (j, now) => businessDate('newest disclosure', j?.lastFiled, 5, now),
  },
  {
    label: 'congress trades (Senate)',
    file: 'api/_data/congress.json',
    // the House alone keeps the check above green. Senators file less often
    // (two-week gaps happen), and the Senate eFD site refused the build
    // from 2026-10-23 to 2026-11-09: three weeks with no Senate report is
    // the point to look at it again rather than forget it
    judge: (j, now) => businessDate('newest Senate disclosure', j?.lastFiledBy?.S ?? maxOf((j?.rows || []).filter((r) => String(r?.id || '').startsWith('S:')).map((r) => r?.f)), 15, now),
  },
  {
    label: 'congress source (Senate eFD)',
    file: 'api/_data/congress.json',
    // The date check above cannot tell a quiet fortnight from a refused
    // build, so it waits fifteen business days. The build knows the
    // difference: it records the day the site began answering 403
    // (build-congress.mjs senate_block → senateBlockedSince). That block ran
    // seventeen days behind a workflow warning nobody was sent, and ended
    // before the date check would have spoken. A refusal that clears by the
    // next run is noise; one that lasts three days needs a decision (wait,
    // or a second source).
    judge: (j, now) => {
      const since = j?.senateBlockedSince;
      if (!since) return { ok: true, detail: 'the Senate site answers the build' };
      const days = Math.floor((now - Date.parse(`${since}T00:00:00Z`)) / DAY);
      if (!Number.isFinite(days)) return { ok: false, detail: `refused since "${since}" (not a date)` };
      return { ok: days < SENATE_BLOCK_MAX_DAYS, detail: `refusing the build since ${since} (${days}d, limit ${SENATE_BLOCK_MAX_DAYS}d); Senate data through ${j?.lastFiledBy?.S ?? '—'}` };
    },
  },
  { label: 'consensus (public)', file: 'client/public/consensus.json', judge: (j, now) => quarterDate('quarter', j?.quarter, now) },
  { label: 'consensus (pro)', file: 'api/_data/consensus-pro.json', judge: (j, now) => quarterDate('quarter', j?.quarter, now) },
  {
    label: 'guru activity (/report)',
    file: 'client/public/guru-activity.json',
    judge: (j, now) => quarterDate('newest quarter', maxOf(Array.isArray(j?.quarters) ? j.quarters : []), now),
  },
  {
    label: 'price returns',
    file: 'client/public/returns.json',
    // the newest close any ticker was priced at; the job runs after the US close
    judge: (j, now) => businessDate('newest close', maxOf(Object.values(j?.returns || {}).map((r) => r?.asOf)), 1, now),
  },
  {
    label: 'price returns (rows)',
    file: 'client/public/returns.json',
    // every row's close within a week of the newest: the builds drop a
    // security that stopped trading (stockMetaBuild.js mergeReturns), so a
    // row left behind is a build that forgot to. Eight takeover names (WBD,
    // QRVO, KVUE…) sat in the file for up to six weeks with their final
    // close as "1D" before this check existed.
    judge: (j) => {
      const rows = Object.entries(j?.returns || {});
      const newest = maxOf(rows.map(([, r]) => r?.asOf));
      if (!newest) return { ok: false, detail: 'no close dates in the data' };
      const cutoff = isoDay(Date.parse(`${newest}T00:00:00Z`) - RETURNS_ROW_MAX_AGE_DAYS * DAY);
      const stale = rows.filter(([, r]) => !r?.asOf || r.asOf < cutoff).map(([sym, r]) => `${sym} ${r?.asOf || '—'}`);
      return {
        ok: stale.length === 0,
        detail: stale.length ? `${stale.length} row(s) priced before ${cutoff}: ${stale.slice(0, 10).join(', ')}${stale.length > 10 ? '…' : ''}` : `all ${rows.length} rows priced within ${RETURNS_ROW_MAX_AGE_DAYS} days of ${newest}`,
      };
    },
  },
  {
    label: '13F universe',
    file: 'client/public/universe.json',
    // 13F-HR and 13F-HR/A reach EDGAR every business day, in season or not
    judge: (j, now) => businessDate('newest 13F filing', maxOf((j?.rows || []).map((r) => r?.filed)), 5, now),
  },
  {
    label: 'ticker price meta',
    file: 'api/_data/ticker-meta.json',
    judge: (j, now) => businessDate('newest price', maxOf(Object.values(j || {}).map((m) => m?.asOf)), 1, now),
  },
  // Built in the same run as the universe from the same filings, with no date
  // of their own: they must come from the universe's run.
  { label: 'stock directory', file: 'client/public/stocks.json', derivedFrom: 'client/public/universe.json' },
  { label: 'filer slugs', file: 'api/_data/slugs.json', derivedFrom: 'client/public/universe.json' },
  {
    label: 'guru performance',
    file: 'api/_data/guru-performance.json',
    // the close the returns were computed at; built in the consensus run,
    // after the night's prices
    judge: (j, now) => businessDate('priced at', j?.asOf, 2, now),
  },
  // Written in the same step as guru-performance.json (consensus.yml) and
  // dated by it: the cards carry its numbers, related.json its history.
  { label: 'guru cards (public)', file: 'client/public/guru-cards.json', derivedFrom: 'api/_data/guru-performance.json' },
  { label: 'related managers', file: 'api/_data/related.json', derivedFrom: 'api/_data/guru-performance.json' },
  {
    label: '13F filing feed',
    file: 'client/public/filings.json',
    // same source and rhythm as the universe: filings arrive every business day
    judge: (j, now) => businessDate('newest filing', maxOf((j?.rows || []).map((r) => r?.filed)), 5, now),
  },
  {
    label: 'fundamentals (SEC XBRL)',
    file: 'api/_data/fundamentals.json',
    // across some 4,600 companies a 10-Q or 10-K is filed every business day;
    // this step is continue-on-error in consensus.yml, so nothing else speaks
    judge: (j, now) => businessDate('newest filing read', maxOf(Object.values(j?.byTicker || {}).flatMap((t) => [t?.eps?.filed, t?.div?.filed, t?.shares?.filed])), 5, now),
  },
  {
    label: 'exchange rates (FPI)',
    file: 'api/_data/fpi.json',
    // the newest rate of any currency (ECB publishes daily). One currency
    // falling behind is fx-stale-alarm.mjs's business; this speaks when the
    // whole table stops moving, i.e. the fpi job stopped committing.
    judge: (j, now) => businessDate('newest rate', newestRate(j?.rates), 5, now),
  },
  {
    label: 'share splits',
    file: 'api/_data/splits.json',
    judge: judgeSplits,
    // a provider refusing the endpoint is reported once by the provider
    // alarm (the run record names it); shown here, not rung twice a day
    knownIssue: (health) => {
      const rec = health?.splits;
      return rec?.known_issue && judgeHealth(rec)?.ok === false ? `known issue (${rec.known_issue} alarm): ${rec.last_error}` : null;
    },
  },
];

// Health records written by the jobs themselves (api/_data/freshness/*.json):
// a job whose last error is newer than its last success is failing now.
export function judgeHealth(rec) {
  if (!rec) return null;
  const err = rec.last_error_at || '';
  const ok = rec.last_success_at || '';
  const failing = Boolean(rec.last_error) && err > ok;
  return {
    ok: !failing,
    detail: failing ? `failing since ${err.slice(0, 16)}Z: ${String(rec.last_error).slice(0, 200)}` : `last success ${ok ? ok.slice(0, 16) + 'Z' : '—'}`,
  };
}

export function runChecks(read, { now = Date.now(), health = {} } = {}) {
  const out = [];
  for (const c of CHECKS) {
    const data = read(c.file);
    if (data == null) {
      out.push({ label: c.label, status: 'MISSING', detail: c.file });
      continue;
    }
    let v;
    if (c.derivedFrom) {
      const src = read(c.derivedFrom);
      const a = Date.parse(data.updatedAt || '');
      const b = Date.parse(src?.updatedAt || '');
      const ok = Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < DAY;
      v = { ok, detail: ok ? `same run as ${c.derivedFrom}` : `not rebuilt with ${c.derivedFrom} (${data.updatedAt?.slice(0, 10) ?? '—'} vs ${src?.updatedAt?.slice(0, 10) ?? '—'})` };
    } else {
      v = c.judge(data, now);
    }
    const known = !v.ok && c.knownIssue ? c.knownIssue(health) : null;
    out.push({ label: c.label, status: v.ok ? 'ok' : known ? 'WARN' : 'STALE', detail: known ? `${v.detail} — ${known}` : v.detail });
  }
  for (const [name, rec] of Object.entries(health)) {
    const v = judgeHealth(rec);
    if (!v) continue;
    // A provider refusing us is a known issue with its own GitHub issue
    // (providerAlarm.js); here it is shown, never counted as a failure.
    // …and so is a job whose only failure is that refusal (known_issue).
    if (rec.kind === 'provider') out.push({ label: `provider: ${name}`, status: v.ok ? 'ok' : 'WARN', detail: v.detail });
    else if (!v.ok && rec.known_issue) out.push({ label: `job: ${name}`, status: 'WARN', detail: `${v.detail} (known issue: ${rec.known_issue} alarm)` });
    else out.push({ label: `job: ${name}`, status: v.ok ? 'ok' : 'FAILING', detail: v.detail });
  }
  return out;
}
