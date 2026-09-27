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
// Only datasets with no date of their own (related managers, share splits)
// fall back to the write time, and say so in the report.
import { businessDaysBehind, dataFreshness, isoDay } from '../../client/src/lib/secCalendar.js';

const DAY = 86400000;
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

const writtenWithin = (data, maxDays, now) => {
  const t = Date.parse(data?.updatedAt || '');
  if (!Number.isFinite(t)) return { ok: false, detail: 'no date in the data and no updatedAt' };
  const age = Math.floor((now - t) / DAY);
  return { ok: age <= maxDays, detail: `no date of its own — written ${isoDay(t)} (${age}d, limit ${maxDays}d)` };
};

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
  { label: 'related managers', file: 'api/_data/related.json', judge: (j, now) => writtenWithin(j, 2, now) },
  { label: 'share splits', file: 'api/_data/splits.json', judge: (j, now) => writtenWithin(j, 2, now) },
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
    out.push({ label: c.label, status: v.ok ? 'ok' : 'STALE', detail: v.detail });
  }
  for (const [name, rec] of Object.entries(health)) {
    const v = judgeHealth(rec);
    if (v) out.push({ label: `job: ${name}`, status: v.ok ? 'ok' : 'FAILING', detail: v.detail });
  }
  return out;
}
