// The nightly re-check of the split table (scripts/build-splits.mjs), as
// functions a test can run without the network.
//
// Why this exists: Twelve Data's /splits is not on the free plan. From the
// night Yahoo left the chain (2026-10-02) the provider refused the first
// request of every run, the script logged a console.warn, rewrote the table
// unchanged and exited 0. Seven weeks of green runs re-checked no ticker
// (`checked` stayed {}), the freshness check read the file's write time and
// said "ok", and no provider record was written because the script called
// tdGet without noting the answer. Two 3-for-1 splits (SOXX, ITA) are missing
// from the table as a result.
//
// A run now leaves two traces:
//   · every provider answer is noted (providerAlarm.js) — a plan refusal
//     opens the provider's known-issue alarm, once;
//   · api/_data/freshness/splits.json records what the run did (candidates,
//     rechecked, failed, refused), and freshnessChecks.js judges the table by
//     the re-check dates inside it, never by when the file was written.

// A used-up minute/day quota: normal on the free plan, the run stops and the
// rest of the queue waits for tomorrow. Checked before the plan wording,
// because Twelve Data's quota message also mentions "plan".
const QUOTA_RE = /run out|credits|\b429\b|rate limit|current limit/i;
// The account may not call this endpoint at all (plan, key, permission).
const REFUSAL_RE = /exclusively|upgrad|plan\b|plans\b|subscription|not (?:available|allowed|authorized)|access|api ?key|\b(401|402|403)\b/i;

// 'quota' | 'refused' | 'error'
export function classifySplitError(msg) {
  const s = String(msg || '');
  if (QUOTA_RE.test(s)) return 'quota';
  if (REFUSAL_RE.test(s)) return 'refused';
  return 'error';
}

const parseSplits = (d) =>
  (d?.splits || [])
    .map((s) => ({ date: String(s.date).slice(0, 10), ratio: Number(s.to_factor) / Number(s.from_factor) }))
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && Number.isFinite(s.ratio) && s.ratio > 0 && s.ratio !== 1)
    .sort((a, b) => a.date.localeCompare(b.date));

// Re-check `queue` in order. Mutates byTicker and checked for every ticker
// the provider answered; stops at the first quota or plan answer (the rest
// keep their entries). `get(ticker)` resolves to the provider's body or
// throws; `note(name, answer)` is providerAlarm.noteProvider.
export async function recheckSplits({ queue, get, today, byTicker, checked, note = () => {}, wait = async () => {}, log = console }) {
  const out = { candidates: queue.length, rechecked: 0, failed: 0, refusal: null, quota: null };
  for (const t of queue) {
    try {
      byTicker[t] = parseSplits(await get(t));
      checked[t] = today;
      out.rechecked++;
      note('twelvedata', { ok: true });
    } catch (e) {
      out.failed++;
      const msg = String(e?.message || e);
      const kind = classifySplitError(msg);
      if (kind === 'refused') {
        out.refusal = msg;
        // said in the alarm issue: which data the refusal costs
        note('twelvedata', { error: `split table not refreshed — /splits: ${msg}`, refused: true });
        log.warn(`::warning::splits: Twelve Data refuses /splits (${msg}) — nothing was re-checked, the table keeps its entries`);
        break;
      }
      if (kind === 'quota') {
        out.quota = msg;
        log.warn(`splits: Twelve Data quota used up (${msg}) — stopping, the rest keep their entries`);
        break;
      }
      note('twelvedata', { error: msg });
    }
    await wait();
  }
  return out;
}

// The run's health record (api/_data/freshness/splits.json), the shape
// freshnessChecks.judgeHealth reads: failing when last_error_at is newer
// than last_success_at.
//   refused   the provider does not serve the endpoint on this account —
//             a known issue with its own alarm (known_issue names it), shown
//             as WARN by the freshness check instead of a nightly red run
//   error     candidates existed and none was re-checked for another reason
//             (no key in CI, every request failed)
// A night cut short by the quota after zero re-checks is not an error on its
// own; the freshness check's date rule speaks if it lasts.
export function splitsRunRecord({ prev = {}, now = new Date().toISOString(), run, reason = null }) {
  const { candidates = 0, rechecked = 0, failed = 0, refusal = null, quota = null } = run || {};
  let error = null;
  if (refusal) error = `Twelve Data refuses /splits: ${String(refusal).slice(0, 200)}`;
  else if (reason) error = reason;
  else if (candidates > 0 && rechecked === 0 && !quota) error = `0 of ${candidates} tickers re-checked (${failed} failed)`;
  return {
    dataset: 'splits',
    last_run_at: now,
    last_success_at: rechecked > 0 && !error ? now : prev.last_success_at || null,
    last_error: error,
    last_error_at: error ? now : prev.last_error_at || null,
    known_issue: refusal ? 'twelvedata' : null,
    candidates,
    rechecked,
    failed,
    refused: refusal ? 1 : 0,
    quota_stop: Boolean(quota),
  };
}

// The newest and oldest day any ticker was re-checked, from the table itself.
export function recheckSpan(table) {
  const days = Object.values(table?.checked || {}).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)));
  if (!days.length) return { count: 0, newest: null, oldest: null };
  days.sort();
  return { count: days.length, newest: days[days.length - 1], oldest: days[0] };
}
