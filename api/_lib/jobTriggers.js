// When the data jobs start, and how a run decides it is not needed.
//
// GitHub's own scheduler started every nightly job 5–7 hours late (fpi 02:47
// → 09:05, insiders 03:31 → ~10:00, once 18:33). The jobs are now started
// on the minute by Supabase pg_cron, which calls GitHub's workflow_dispatch
// API with inputs.trigger = 'cron' (migrations/0005_job_triggers). The GitHub
// `schedule:` entries stay as a fallback; a run from the fallback, from the
// fpi → insiders chain or from the cron does its work only if no earlier run
// in the same window already did (decideRun). check-triggers.mjs raises the
// alarm when a slot started more than LATE_AFTER_MIN late.
//
// TRIGGERS must match the cron.schedule() calls in the migration; a test
// reads the SQL and compares.
export const REPO = 'mustafakocer/13FRadar';

export const TRIGGERS = [
  { job: 'gh-universe', workflow: 'universe.yml', at: '01:23' },
  { job: 'gh-fpi', workflow: 'fpi.yml', at: '02:47' },
  { job: 'gh-freshness-am', workflow: 'freshness.yml', at: '07:23' },
  { job: 'gh-insiders-catchup', workflow: 'insiders.yml', at: '11:02' },
  { job: 'gh-freshness-pm', workflow: 'freshness.yml', at: '13:17' },
];

// Each window opens at a slot and lasts until the next one. Consensus runs
// after the universe (workflow_run), the morning insider run after fpi.
export const WINDOWS = {
  'universe.yml': ['01:23'],
  'consensus.yml': ['01:23'],
  'fpi.yml': ['02:47'],
  'insiders.yml': ['02:47', '11:02'],
};

export const LATE_AFTER_MIN = 15;
// the chained insider run should start this soon after fpi finishes
export const CHAIN_AFTER_MIN = 15;

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const atOn = (dayMs, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return dayMs + (h * 60 + m) * MIN;
};
const dayOf = (ms) => Math.floor(ms / DAY) * DAY;

// The start of the window `now` falls in: the latest slot at or before now,
// today or (before the first slot of the day) yesterday.
export function windowStart(slots, now) {
  const t = +new Date(now);
  const today = dayOf(t);
  const starts = [...slots.map((s) => atOn(today, s)), ...slots.map((s) => atOn(today - DAY, s))].filter((x) => x <= t);
  return new Date(Math.max(...starts));
}

// Whether this run should do the work.
//   event    github.event_name
//   trigger  inputs.trigger ('cron' from Supabase, else a person)
//   runs     this workflow's runs on main, newest first, each
//            { id, created_at, event, built } — built: its `build` job
//            finished with success (a run that skipped itself did not build)
// A person's dispatch and a push always run. Everything automatic runs
// unless another run in the same window has already built.
export function decideRun({ workflow, event, trigger, now, runs, selfId }) {
  const automatic = event === 'schedule' || event === 'workflow_run' || (event === 'workflow_dispatch' && trigger === 'cron');
  if (!automatic) return { run: true, reason: `${event}${trigger ? ` (${trigger})` : ''}: always runs` };
  const slots = WINDOWS[workflow];
  if (!slots) return { run: true, reason: `${workflow} has no window` };
  const from = windowStart(slots, now);
  const done = runs.find((r) => String(r.id) !== String(selfId) && r.built && +new Date(r.created_at) >= +from && r.event !== 'pull_request');
  if (done) return { run: false, reason: `run ${done.id} (${done.event}, ${done.created_at}) already built this window (from ${from.toISOString()})` };
  return { run: true, reason: `nothing built since ${from.toISOString()}` };
}

const fmt = (ms) => {
  const m = Math.round(ms / MIN);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

// Did each slot of the last 24 hours start on time? runsByWorkflow maps a
// workflow file to its runs on main (newest first; created_at, updated_at,
// status, event). A slot counts once LATE_AFTER_MIN has passed. The first
// automatic run created from five minutes before the slot is its start.
// Slots before activeFrom (the day the trigger went live) are not judged.
// Returns [{ ok, what }].
export function checkSlots({ now, runsByWorkflow, activeFrom = null }) {
  const t = +new Date(now);
  const out = [];
  const automatic = (r) => ['schedule', 'workflow_dispatch', 'workflow_run'].includes(r.event);
  const firstAfter = (workflow, from) =>
    (runsByWorkflow[workflow] || [])
      .filter((r) => automatic(r) && +new Date(r.created_at) >= from)
      .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))[0] || null;

  for (const trig of TRIGGERS) {
    let slot = atOn(dayOf(t), trig.at);
    if (slot > t - LATE_AFTER_MIN * MIN) slot -= DAY;
    if (activeFrom && slot < +new Date(activeFrom)) continue;
    const label = `${trig.workflow} ${trig.at} UTC (${new Date(slot).toISOString().slice(0, 10)})`;
    const first = firstAfter(trig.workflow, slot - 5 * MIN);
    if (!first) {
      out.push({ ok: false, what: `${label}: no run started — the Supabase trigger did not fire and the GitHub fallback has not either` });
      continue;
    }
    const late = +new Date(first.created_at) - slot;
    out.push({
      ok: late <= LATE_AFTER_MIN * MIN,
      what: `${label}: started ${first.created_at.slice(11, 16)} (${late <= 0 ? 'on time' : `+${fmt(late)}`}, ${first.event})${late > LATE_AFTER_MIN * MIN ? ' — late: the Supabase trigger did not start it' : ''}`,
    });
    // fpi → insiders: the morning insider run follows fpi's end
    if (trig.workflow === 'fpi.yml' && first.status === 'completed') {
      const end = +new Date(first.updated_at);
      const next = firstAfter('insiders.yml', end - MIN);
      if (t - end < CHAIN_AFTER_MIN * MIN) continue;
      const gap = next ? +new Date(next.created_at) - end : null;
      out.push({
        ok: gap != null && gap <= CHAIN_AFTER_MIN * MIN,
        what: next
          ? `insiders after fpi: fpi ended ${first.updated_at.slice(11, 16)}, insiders started ${next.created_at.slice(11, 16)} (+${fmt(Math.max(0, gap))}, ${next.event})`
          : `insiders after fpi: fpi ended ${first.updated_at.slice(11, 16)}, no insider run since`,
      });
    }
  }
  return out;
}

// GitHub REST helpers (fetch; token needs actions:read).
export async function listRuns({ token, workflow, since, repo = REPO, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?branch=main&per_page=50&created=${encodeURIComponent(`>=${new Date(since).toISOString()}`)}`;
  const res = await fetchImpl(url, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GitHub ${res.status} listing ${workflow} runs`);
  const body = await res.json();
  return (body.workflow_runs || []).map((r) => ({ id: r.id, created_at: r.created_at, updated_at: r.updated_at, status: r.status, conclusion: r.conclusion, event: r.event }));
}

export async function builtOf({ token, runId, repo = REPO, fetchImpl = fetch }) {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=50`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`GitHub ${res.status} listing jobs of run ${runId}`);
  const body = await res.json();
  return (body.jobs || []).some((j) => j.name === 'build' && j.conclusion === 'success');
}

const ghHeaders = (token) => ({
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'fundocap-jobs',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});
