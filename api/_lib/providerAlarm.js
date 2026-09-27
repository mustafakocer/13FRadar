// Paid data providers refusing us, made loud.
//
// When FMP started answering HTTP 402 ("not available under your current
// subscription") the nightly builds logged a ::warning:: and went green —
// the same silent-failure shape as the insider outage. Batch builds now note
// every FMP answer here; at the end of the run `flushProviderHealth` writes
// api/_data/freshness/<provider>.json (the shared health record the freshness
// check reads) and prints a ::error:: for a refusal, and the workflow step
// `node scripts/check-job-health.mjs fmp` turns the run red and alerts.
//
// Batch-only: the live API must never write files, so nothing under
// api/_handlers calls this.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const seen = new Map(); // provider -> { ok, refusals: [msg] , errors }

// 401/402/403 and the plan wording: an account problem, not a blip.
export const isRefusal = (msg) => /\b(401|402|403)\b|premium|subscription|upgrade your plan|invalid api key|limit reach/i.test(String(msg || ''));

export function noteProvider(name, { ok = false, error = null } = {}) {
  if (!seen.has(name)) seen.set(name, { ok: 0, refusals: [], errors: 0 });
  const s = seen.get(name);
  if (ok) s.ok++;
  else if (error && isRefusal(error)) s.refusals.push(String(error).slice(0, 200));
  else if (error) s.errors++;
}

export function flushProviderHealth({ dir = path.join(root, 'api', '_data', 'freshness'), now = new Date().toISOString(), log = console } = {}) {
  const out = [];
  for (const [name, s] of seen) {
    const file = path.join(dir, `${name}.json`);
    let prev = {};
    try {
      prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* first record */
    }
    // two builds in one workflow run (stock meta, then prices) write the same
    // record: a refusal earlier in the run must not be masked by a later
    // step that happened not to call FMP at all
    const runId = process.env.GITHUB_RUN_ID || null;
    const carried = runId && prev.run_id === runId && prev.refusals > 0 ? prev : null;
    if (carried) s.refusals.push(...Array(prev.refusals).fill(String(prev.last_error || '').replace(/^\d+ refusal\(s\): /, '')));
    const refused = s.refusals.length > 0;
    const rec = {
      dataset: name,
      run_id: runId,
      last_run_at: now,
      last_success_at: !refused && s.ok ? now : prev.last_success_at || null,
      last_error: refused ? `${s.refusals.length} refusal(s): ${s.refusals[0]}` : null,
      last_error_at: refused ? now : prev.last_error_at || null,
      calls_ok: s.ok,
      refusals: s.refusals.length,
      transient_errors: s.errors,
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rec, null, 1));
    if (refused) log.error(`::error::${name.toUpperCase()} refused ${s.refusals.length} request(s) — check the subscription: ${s.refusals[0]}`);
    out.push(rec);
  }
  seen.clear();
  return out;
}
