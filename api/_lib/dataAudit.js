// The gate every rebuilt dataset passes before it is allowed to be committed.
//
// A data site fails quietly. The build runs, the files are written, the numbers
// are wrong, and nothing anywhere says so — the filings feed reported "0 13F
// filings" for eight business days and read as a slow week. So the rules that
// decide whether a file is publishable live here, as pure functions over
// already-parsed JSON, and scripts/audit-data.mjs does the reading, the git
// baseline and the exit code.
//
// Three questions are asked of every dataset:
//   · is it structurally whole — does it parse, carry its keys, and hold at
//     least the number of rows below which it is obviously broken;
//   · has it moved more than a rebuild plausibly moves it, measured against
//     the last committed copy of the same file;
//   · does it break a rule the data can never break — a trade dated after
//     its filing, a fund a quarter behind the rest of its panel, a sector
//     column that has gone empty.
// The second is the one that catches a bad upstream day. A quarter's rebuild
// shifts counts by a few percent; a truncated SEC response halves them.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Rows, whichever shape a file keeps them in. A count that is already a number
// is taken as given, which is how the teaser reports its total.
export function size(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v)) return v.length;
  if (isObj(v)) return Object.keys(v).length;
  return null;
}

// How many rows satisfy a predicate, whichever shape the rows come in.
export function count(v, pred) {
  const rows = Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [];
  let n = 0;
  for (const r of rows) if (pred(r)) n++;
  return n;
}

// Managers whose latest quarter trails the panel's. Every fund files for the
// same quarter within the same 45-day window, so one sitting a quarter or
// more behind the median has either stopped filing or has a filing the
// build failed to pick up — and its old book is voting on this quarter's
// consensus either way.
export function laggingManagers(managers, { quarters = 1 } = {}) {
  const rows = (Array.isArray(managers) ? managers : []).filter((m) => m?.reportDate);
  if (rows.length < 5) return [];
  const dates = rows.map((m) => String(m.reportDate)).sort();
  const median = dates[Math.floor(dates.length / 2)];
  // quarters are compared as calendar quarters, so a quarter that ends on
  // the 30th is one behind a median that ends on the 31st, not "a day short"
  const quarterIx = (d) => {
    const y = Number(d.slice(0, 4));
    const m = Number(d.slice(5, 7));
    return y * 4 + Math.floor((m - 1) / 3);
  };
  return rows
    .filter((m) => quarterIx(median) - quarterIx(String(m.reportDate)) >= quarters)
    .map((m) => ({
      severity: 'warn',
      rule: 'lagging',
      message: `${m.name || m.cik} last reported ${m.reportDate}, panel median ${median}`,
      cik: m.cik,
    }));
}

// Every file the builds commit, with the counts worth watching and the floor
// below which the file is broken rather than merely small.
//
// Floors are deliberately far under today's values: a floor that tracks the
// current number turns every ordinary fluctuation into a failed build, and a
// gate people switch off protects nothing. Drift catches the gradual case;
// the floor is only there for the collapse.
//
// A dataset whose size is seasonal rather than stable opts out of both, and
// says why where it is declared.
export const DATASETS = [
  {
    key: 'consensus',
    path: 'client/public/consensus.json',
    require: ['updatedAt', 'managers', 'mostHeld'],
    metrics: (d) => ({ managers: size(d.managers), mostHeld: size(d.mostHeld), updates: size(d.updates) }),
    floors: { managers: 20, mostHeld: 10 },
  },
  {
    key: 'consensus-pro',
    path: 'api/_data/consensus-pro.json',
    require: ['updatedAt', 'managers', 'mostHeld'],
    metrics: (d) => ({
      managers: size(d.managers),
      mostHeld: size(d.mostHeld),
      topBought: size(d.topBought),
      topSold: size(d.topSold),
      newPositions: size(d.newPositions),
    }),
    floors: { managers: 20, mostHeld: 10 },
    checks: (d) => laggingManagers(d.managers),
  },
  {
    key: 'guru-stocks',
    path: 'api/_data/guru-stocks.json',
    require: ['updatedAt', 'managers', 'stocks'],
    metrics: (d) => ({
      managers: size(d.managers),
      stocks: size(d.stocks),
      options: size(d.options),
      withTicker: count(d.stocks, (s) => s?.ticker),
      withSector: count(d.stocks, (s) => s?.sector),
      withCap: count(d.stocks, (s) => s?.marketCap > 0),
    }),
    floors: { managers: 20, stocks: 200 },
    // The screener's sector and size filters ran empty for months while every
    // build stayed green: the provider had quietly stopped answering. These
    // do not block — sector and cap are best-effort columns — but they say so.
    warnFloors: { withTicker: 800, withSector: 500, withCap: 500 },
  },
  {
    key: 'guru-history',
    path: 'api/_data/guru-history.json',
    require: ['gurus'],
    metrics: (d) => ({ gurus: size(d.gurus) }),
    floors: { gurus: 20 },
  },
  {
    key: 'guru-activity',
    path: 'client/public/guru-activity.json',
    require: ['updatedAt', 'quarters'],
    metrics: (d) => ({ quarters: size(d.quarters), names: size(d.names) }),
    floors: { quarters: 4 },
  },
  {
    key: 'insiders',
    path: 'api/_data/insiders.json',
    require: ['updatedAt', 'rows'],
    metrics: (d) => ({
      rows: size(d.rows),
      companies: size(d.companies),
      // a trade dated after the filing that reports it: the build drops these,
      // so one getting through means the rule in the build has regressed
      futureDated: count(d.rows, (r) => r?.d && r?.f && String(r.d) > String(r.f)),
    }),
    floors: { rows: 5000 },
    ceilings: { futureDated: 0 },
  },
  {
    key: 'insiders-teaser',
    path: 'client/public/insiders-teaser.json',
    require: ['updatedAt'],
    metrics: (d) => ({ total: size(d.total), penny: size(d.penny) }),
    floors: { total: 1000 },
  },
  {
    key: 'universe',
    path: 'client/public/universe.json',
    require: ['updatedAt', 'rows'],
    metrics: (d) => ({ rows: size(d.rows) }),
    floors: { rows: 3000 },
  },
  {
    key: 'latest-holdings',
    path: 'api/_data/latest-holdings.json',
    // written by the universe build from the same pass that ranks the
    // universe; absent only until that build has run once with this code
    optional: true,
    require: ['updatedAt', 'byCik'],
    metrics: (d) => ({ filers: size(d.byCik), withRows: count(d.byCik, (e) => Array.isArray(e?.top) && e.top.length > 0) }),
    floors: { filers: 3000 },
  },
  {
    key: 'stocks',
    path: 'client/public/stocks.json',
    require: ['updatedAt', 'rows'],
    metrics: (d) => ({ rows: size(d.rows) }),
    floors: { rows: 100 },
  },
  {
    key: 'returns',
    path: 'client/public/returns.json',
    require: ['updatedAt', 'returns'],
    metrics: (d) => ({ tickers: size(d.returns) }),
    floors: { tickers: 100 },
  },
  {
    // the nightly price cache's summary (the series themselves are one file
    // per symbol next to it); optional until the first build has run
    key: 'prices',
    path: 'api/_data/prices/_index.json',
    optional: true,
    require: ['updatedAt', 'count'],
    metrics: (d) => ({ series: d.count || 0, coveragePct: d.coveragePct || 0 }),
    floors: { series: 50 },
    drift: false,
  },
  {
    key: 'splits',
    path: 'api/_data/splits.json',
    require: ['updatedAt', 'byTicker'],
    metrics: (d) => ({ tickers: size(d.byTicker) }),
    floors: { tickers: 1000 },
  },
  {
    key: 'security-master',
    path: 'api/_data/security-master.json',
    optional: true,
    require: ['byCusip'],
    metrics: (d) => ({ resolved: size(d.byCusip), unresolved: size(d.unresolved) }),
    floors: { resolved: 3000 },
  },
  {
    key: 'related',
    path: 'api/_data/related.json',
    require: ['related'],
    metrics: (d) => ({ managers: size(d.related) }),
    floors: { managers: 20 },
  },
  {
    key: 'slugs',
    path: 'api/_data/slugs.json',
    require: ['bySlug', 'byCik'],
    metrics: (d) => ({ bySlug: size(d.bySlug), byCik: size(d.byCik) }),
    floors: { bySlug: 3000, byCik: 3000 },
  },
  // The feed is a rolling window over filings as they land, and 13F filings
  // bunch around the 45-day deadline: 81 rows in the week after one, close to
  // none a month later. Neither a floor nor a drift band can tell that from a
  // broken parser, so both are off and the build says so in words instead —
  // build-filings.mjs warns when every index read cleanly and nothing matched.
  { key: 'filings', path: 'client/public/filings.json', require: ['updatedAt', 'rows'], metrics: (d) => ({ rows: size(d.rows) }), floors: {}, drift: false },
  { key: 'filer-states', path: 'client/public/filer-states.json', require: ['updatedAt', 'byCik'], metrics: (d) => ({ filers: size(d.byCik) }), floors: {}, drift: false },
  // written only when the sector lookup found something, so its absence is
  // reported and never fatal
  { key: 'sector-map', path: 'api/_data/sector-map.json', optional: true, require: [], metrics: (d) => ({ symbols: size(d.bySymbol) || size(d) }), floors: {} },
];

export const WARN_DRIFT = 0.3;
export const ERROR_DRIFT = 0.6;

// Below this, a baseline is too small for a percentage to mean anything: two
// rows becoming three is a 50% jump and tells you nothing.
export const MIN_BASELINE = 20;

// How far one metric moved, and whether that is far enough to say something.
// Returns null when there is nothing to compare against, which is not a
// finding — a dataset builds for the first time exactly once.
export function driftVerdict(value, baseline, opts = {}) {
  const warn = opts.warn ?? WARN_DRIFT;
  const error = opts.error ?? ERROR_DRIFT;
  const minBaseline = opts.minBaseline ?? MIN_BASELINE;
  if (!Number.isFinite(value) || !Number.isFinite(baseline)) return null;
  if (baseline < minBaseline) return null;
  const change = (value - baseline) / baseline;
  const size_ = Math.abs(change);
  if (size_ < warn) return null;
  // A bad upstream day makes a file smaller: a truncated response, a feed
  // that answered nothing, a parser that matched nothing. It does not make a
  // file four times larger — that is a fix landing (the return file went
  // from 396 tickers to 1,646 the day its provider was replaced) or the
  // bench growing, and blocking it would hold the fix hostage to a flag.
  // Growth is said out loud; only a collapse stops the commit.
  return { severity: size_ >= error && change < 0 ? 'error' : 'warn', change };
}

const RANK = { ok: 0, info: 1, warn: 2, error: 3 };
export const worstOf = (severities) =>
  severities.reduce((w, s) => (RANK[s] > RANK[w] ? s : w), 'ok');

const pct = (n) => `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

// One dataset against its last committed self. `current` and `baseline` are
// already-parsed JSON, or null for a file that is not there.
export function auditDataset({ spec, current, baseline = null, allowDrift = false }) {
  const findings = [];
  const add = (severity, rule, message, extra = {}) =>
    findings.push({ dataset: spec.key, rule, severity, message, ...extra });

  if (current === null || current === undefined) {
    add(spec.optional ? 'info' : 'error', 'missing', spec.optional ? 'not produced this run' : 'file is missing');
    return { key: spec.key, path: spec.path, metrics: {}, findings };
  }
  if (!isObj(current)) {
    add('error', 'shape', 'file is not a JSON object');
    return { key: spec.key, path: spec.path, metrics: {}, findings };
  }

  for (const key of spec.require || []) {
    if (current[key] === undefined || current[key] === null) add('error', 'missing-key', `no "${key}"`);
  }

  let metrics = {};
  try {
    metrics = spec.metrics(current) || {};
  } catch (e) {
    add('error', 'shape', `counts could not be read: ${e.message}`);
    return { key: spec.key, path: spec.path, metrics: {}, findings };
  }

  for (const [name, floor] of Object.entries(spec.floors || {})) {
    const v = metrics[name];
    if (!Number.isFinite(v)) add('error', 'floor', `${name} could not be counted`, { metric: name });
    else if (v < floor) add('error', 'floor', `${name} is ${v}, below the floor of ${floor}`, { metric: name, value: v, floor });
  }
  // A soft floor: the column is optional, but its emptiness should be visible
  // in the log and the report rather than discovered on the page.
  for (const [name, floor] of Object.entries(spec.warnFloors || {})) {
    const v = metrics[name];
    if (!Number.isFinite(v)) add('warn', 'floor', `${name} could not be counted`, { metric: name });
    else if (v < floor) add('warn', 'floor', `${name} is ${v}, below the expected ${floor}`, { metric: name, value: v, floor });
  }
  // An invariant: a count of rows that should not exist at all.
  for (const [name, ceiling] of Object.entries(spec.ceilings || {})) {
    const v = metrics[name];
    if (!Number.isFinite(v)) add('error', 'ceiling', `${name} could not be counted`, { metric: name });
    else if (v > ceiling) add('error', 'ceiling', `${name} is ${v}, above the ceiling of ${ceiling}`, { metric: name, value: v, ceiling });
  }
  // Dataset-specific rules that are not a count against a number.
  if (typeof spec.checks === 'function') {
    try {
      for (const f of spec.checks(current) || []) add(f.severity || 'warn', f.rule || 'check', f.message, f.cik ? { cik: f.cik } : {});
    } catch (e) {
      add('warn', 'check', `custom check failed to run: ${e.message}`);
    }
  }

  if (spec.drift === false) return { key: spec.key, path: spec.path, metrics, findings };

  if (!baseline || !isObj(baseline)) {
    add('info', 'drift', 'no previous version to compare against');
    return { key: spec.key, path: spec.path, metrics, findings };
  }

  let before = {};
  try {
    before = spec.metrics(baseline) || {};
  } catch {
    add('info', 'drift', 'previous version could not be counted, drift skipped');
    return { key: spec.key, path: spec.path, metrics, findings };
  }

  for (const [name, value] of Object.entries(metrics)) {
    const v = driftVerdict(value, before[name]);
    if (!v) continue;
    // An override exists because a real change — the guru bench going from 20
    // names to 99 — looks exactly like a bad day to this rule, and a gate with
    // no way past it is a gate that gets deleted.
    const severity = allowDrift && v.severity === 'error' ? 'warn' : v.severity;
    add(severity, 'drift', `${name} moved ${pct(v.change)}, ${before[name]} → ${value}${allowDrift && v.severity === 'error' ? ' (drift override on)' : ''}`, {
      metric: name,
      value,
      baseline: before[name],
      change: v.change,
    });
  }

  return { key: spec.key, path: spec.path, metrics, findings };
}

// Every dataset, plus the one verdict the build acts on.
export function auditAll(entries, { allowDrift = false } = {}) {
  const datasets = entries.map(({ spec, current, baseline }) =>
    auditDataset({ spec, current, baseline, allowDrift })
  );
  const worst = worstOf(datasets.flatMap((d) => d.findings.map((f) => f.severity)));
  return { worst, datasets };
}
