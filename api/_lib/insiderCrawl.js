// Which EDGAR daily indexes to read, reading them, and where the checkpoint
// may move afterwards. Network-free: the HTTP `get`, the clock and `sleep`
// are injected, so every rule below has a test (tests/insider-crawl.test.mjs).
//
// What went wrong before (postmortem docs/postmortems/2026-09-insider-outage.md):
// a day missing from EDGAR's quarter listing was treated as a holiday. At run
// time today's index is always missing — EDGAR publishes it in the evening —
// so every morning the crawl "skipped" today, moved the checkpoint over it and
// never came back. 2026-09-21 → 09-25 were lost that way behind green runs.
//
// The rule now: a day is settled without being read only when
//   (a) it is a Saturday or Sunday, or
//   (b) it is an SEC holiday (static list in secCalendar.js), or
//   (c) EDGAR has published the index of a LATER business day but not this one
//       (a closure the list does not know about).
// Anything else not yet in the listing is PENDING, and the checkpoint never
// moves past a pending day. The checkpoint is the last day that was either
// read successfully or settled by those three rules — nothing else.
import { addDays, businessDaysBehind, isSecBusinessDay, isSecHoliday, isWeekend } from '../../client/src/lib/secCalendar.js';
import { BadFilingError, parseForm4Submission } from './insiderForm4.js';

export const quarterNum = (day) => Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1;
export const quarterKey = (day) => `${day.slice(0, 4)}Q${quarterNum(day)}`;
export const indexUrl = (day) =>
  `https://www.sec.gov/Archives/edgar/daily-index/${day.slice(0, 4)}/QTR${quarterNum(day)}/form.${day.replace(/-/g, '')}.idx`;
export const listingUrl = (day) =>
  `https://www.sec.gov/Archives/edgar/daily-index/${day.slice(0, 4)}/QTR${quarterNum(day)}/index.json`;

// Defaults. The workflow may override the volume floor (INSIDER_MIN_FORM4).
export const DEFAULTS = {
  rescanBusinessDays: 3, // re-read the last N business days on every run: late filings, 4/A
  maxDays: 45, // new days per run, so a long backlog is worked off over several runs
  minForm4PerDay: 200, // a real business day has ~1,000–2,000; fewer means a broken read
  backoffMs: [2000, 4000, 8000, 16000], // 403/429/5xx: four retries, exponential
};

// ---------------------------------------------------------------- the plan
//
// `published(day)` → the Set of days EDGAR lists for that day's quarter, or
// null when the listing could not be read (the day is then probed directly).
//
// Returns, in date order:
//   scan      [{ day, rescan }]  days to read this run
//   timeline  [{ day, state }]   every day after the checkpoint up to today:
//             'settled' (with `reason`), 'scan', 'pending' or 'deferred'
//             (would be scanned, but over this run's cap)
export function planScan({ checkpoint, today, published = () => null, rescanBusinessDays = DEFAULTS.rescanBusinessDays, maxDays = DEFAULTS.maxDays }) {
  if (!checkpoint || !today) throw new Error('planScan needs a checkpoint and today');
  const listed = (day) => {
    const set = published(day);
    return set ? set.has(day) : null; // null = unknown
  };

  // Rescan window: the last N business days up to and including the checkpoint.
  const rescan = [];
  for (let d = checkpoint; rescan.length < rescanBusinessDays && d > addDays(checkpoint, -30); d = addDays(d, -1)) {
    if (isSecBusinessDay(d) && listed(d) !== false) rescan.unshift(d);
  }

  // Newest business day EDGAR has published up to today, for rule (c).
  let newestPublished = null;
  for (let d = today; d > checkpoint; d = addDays(d, -1)) {
    if (isSecBusinessDay(d) && listed(d) === true) {
      newestPublished = d;
      break;
    }
  }

  const timeline = [];
  let newCount = 0;
  for (let d = addDays(checkpoint, 1); d <= today; d = addDays(d, 1)) {
    if (isWeekend(d)) timeline.push({ day: d, state: 'settled', reason: 'weekend' });
    else if (isSecHoliday(d)) timeline.push({ day: d, state: 'settled', reason: 'holiday' });
    else {
      const l = listed(d);
      if (l === false && newestPublished && newestPublished > d) timeline.push({ day: d, state: 'settled', reason: 'unpublished' });
      else if (l === false) timeline.push({ day: d, state: 'pending' });
      else if (newCount < maxDays) {
        timeline.push({ day: d, state: 'scan', probe: l === null });
        newCount++;
      } else timeline.push({ day: d, state: 'deferred' });
    }
  }

  const scan = [
    ...rescan.map((day) => ({ day, rescan: true })),
    ...timeline.filter((t) => t.state === 'scan').map((t) => ({ day: t.day, rescan: false, probe: t.probe })),
  ];
  return { scan, timeline, rescan };
}

// Where the checkpoint lands: the end of the unbroken run of days after the
// old checkpoint that are settled or were read successfully (`ok` holds the
// days that were). The first failed, pending or deferred day stops it.
export function advanceCheckpoint(checkpoint, timeline, ok) {
  let cp = checkpoint;
  for (const t of timeline) {
    if (t.state === 'settled' || (t.state === 'scan' && ok.has(t.day))) cp = t.day;
    else break;
  }
  return cp;
}

// Everything that should turn the run red, as readable sentences. Empty when
// the run is healthy.
export function runProblems({ checkpoint, newCheckpoint, today, timeline, results }) {
  const problems = [];
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) problems.push(`${r.day}: ${r.error}`);

  // Days were due and none was read: the exact shape of the September outage.
  const due = timeline.filter((t) => t.state === 'scan');
  const readNew = results.filter((r) => !r.rescan && r.ok);
  if (due.length && !readNew.length) problems.push(`${due.length} day(s) were due and none was read — the crawl made no progress`);

  // A business day still unpublished a full business day later: EDGAR is not
  // publishing, or we cannot see its listing. Either way somebody should look.
  for (const t of timeline) {
    if (t.state === 'pending' && businessDaysBehind(t.day, today) >= 1)
      problems.push(`${t.day}: EDGAR has not published this day's index and nothing later either — pending for over a business day`);
  }
  if (newCheckpoint < checkpoint) problems.push(`checkpoint moved backwards (${checkpoint} → ${newCheckpoint})`);
  return problems;
}

// ---------------------------------------------------------------- HTTP
const RETRY_STATUS = new Set([403, 429, 500, 502, 503, 504]);

// One GET with retries on refusals and transient errors. `get(url)` resolves
// to { status, data } and may throw on network errors. Returns the last
// { status, data } (status 0 for a network error that never cleared).
export async function getWithRetry(get, url, { backoffMs = DEFAULTS.backoffMs, sleep = defaultSleep, log = () => {} } = {}) {
  let last = { status: 0, data: null, error: null };
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      last = await get(url);
    } catch (e) {
      last = { status: 0, data: null, error: String(e.message || e) };
    }
    if (last.status && !RETRY_STATUS.has(last.status)) return last;
    if (attempt < backoffMs.length) {
      log(`  EDGAR ${last.status || last.error} for ${url} — retry ${attempt + 1}/${backoffMs.length} in ${backoffMs[attempt] / 1000}s`);
      await sleep(backoffMs[attempt]);
    }
  }
  return last;
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Form 4 / 4/A entries of one daily form index.
export function parseFormIndex(body) {
  const out = [];
  for (const line of String(body || '').split('\n')) {
    const m = /^(4(?:\/A)?)\s/.exec(line);
    if (!m) continue;
    const file = line.trim().split(/\s+/).pop();
    if (file && file.endsWith('.txt')) out.push({ path: file, form: m[1] });
  }
  return out;
}

// Which days EDGAR published for the quarter of `day`, or null if unknown.
export async function fetchListing(get, day, opts) {
  const r = await getWithRetry(get, listingUrl(day), opts);
  let data = r.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  if (r.status !== 200 || !Array.isArray(data?.directory?.item)) return null;
  return new Set(
    data.directory.item
      .map((it) => /^form\.(\d{4})(\d{2})(\d{2})\.idx$/.exec(it?.name || ''))
      .filter(Boolean)
      .map((m) => `${m[1]}-${m[2]}-${m[3]}`)
  );
}

// ---------------------------------------------------------------- one day
//
// Reads one daily index and every Form 4 in it. Never throws for a bad
// filing: BadFilingError goes to `errors` and the loop moves on. A filing
// EDGAR keeps refusing after all retries goes to `fetchFailed` and fails the
// day, so the day is read again next run instead of being marked done with
// holes in it.
export async function crawlDay(day, { get, minForm4PerDay = DEFAULTS.minForm4PerDay, concurrency = 8, keep = () => true, log = () => {}, now = () => new Date().toISOString(), ...retry }) {
  const result = { day, ok: false, form4: 0, filings: 0, rows: [], raw: {}, accessions: new Set(), errors: [], fetchFailed: [], error: null };
  const idx = await getWithRetry(get, indexUrl(day), { log, ...retry });
  if (idx.status === 404) {
    result.error = 'no daily index (HTTP 404)';
    result.missing = true;
    return result;
  }
  if (idx.status !== 200 || typeof idx.data !== 'string') {
    result.error = `daily index HTTP ${idx.status || idx.error || 'error'} after ${(retry.backoffMs || DEFAULTS.backoffMs).length} retries`;
    return result;
  }
  const files = parseFormIndex(idx.data);
  result.form4 = files.length;

  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (i < files.length) {
        const f = files[i++];
        const url = `https://www.sec.gov/Archives/${f.path}`;
        const r = await getWithRetry(get, url, { log, ...retry });
        if (r.status !== 200 || typeof r.data !== 'string') {
          result.fetchFailed.push({ path: f.path, status: r.status || r.error || 'error' });
          continue;
        }
        try {
          const parsed = await parseForm4Submission(r.data, { filed: day, path: f.path, formType: f.form });
          result.filings++;
          result.accessions.add(parsed.accession);
          for (const row of parsed.rows) {
            if (!keep(row)) continue;
            result.rows.push(row);
            const id = `${row.a}:${row.li}`;
            if (parsed.raw[id]) result.raw[id] = parsed.raw[id];
          }
        } catch (e) {
          if (!(e instanceof BadFilingError)) throw e;
          const acc = /(\d{10}-\d{2}-\d{6})/.exec(f.path)?.[1] || f.path;
          result.errors.push({ accession: acc, path: f.path, day, error: e.message, at: now() });
        }
      }
    })
  );

  if (result.fetchFailed.length) {
    const sample = result.fetchFailed.slice(0, 3).map((x) => `${x.path} (${x.status})`).join(', ');
    result.error = `${result.fetchFailed.length} of ${files.length} filings refused after retries: ${sample}`;
  } else if (files.length < minForm4PerDay) {
    result.error = `only ${files.length} Form 4 filings in the index (floor ${minForm4PerDay}) — a real business day has far more`;
  } else {
    result.ok = true;
  }
  return result;
}

// ---------------------------------------------------------------- one run
// Plan, read, and move the checkpoint — the nightly job's whole crawl, and
// what the regression tests drive day by day. `published` is the listing
// lookup (see planScan); `get` the HTTP transport.
export async function crawlOnce({ checkpoint, today, published, get, rescanBusinessDays, maxDays, minForm4PerDay, keep, log = () => {}, ...retry }) {
  const plan = planScan({ checkpoint, today, published, rescanBusinessDays, maxDays });
  const results = [];
  for (const { day, rescan } of plan.scan) {
    const r = await crawlDay(day, { get, minForm4PerDay, keep, log, ...retry });
    results.push({ ...r, rescan });
  }
  const ok = new Set(results.filter((r) => r.ok).map((r) => r.day));
  const newCheckpoint = advanceCheckpoint(checkpoint, plan.timeline, ok);
  const problems = runProblems({ checkpoint, newCheckpoint, today, timeline: plan.timeline, results });
  return { plan, results, newCheckpoint, problems };
}
