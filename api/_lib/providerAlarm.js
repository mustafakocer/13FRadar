// Paid and free data providers refusing us — reported once, not every night.
//
// When FMP started answering HTTP 402 ("not available under your current
// subscription") the builds went green with a ::warning:: nobody read. Making
// it red every night would be as bad the other way: an alarm that always
// rings is ignored, which is how the insider outage went unseen for nine days.
// So a provider refusal is a KNOWN ISSUE:
//   · the first refusal opens one `data-alarm` + `known-issue` GitHub issue
//     (with the @mention — that is the notification);
//   · while the same provider keeps refusing, nothing new is sent and the run
//     stays green, with a ::warning:: pointing at the open issue;
//   · a change is announced: the provider answering again closes its issue
//     ("çözüldü", mentioned), and another provider starting to refuse opens
//     its own issue.
// The insider alarm is separate and still goes red on every failure.
//
// Builds note every provider answer here (`noteProvider`); at the end of the
// run `flushProviderHealth` writes api/_data/freshness/<provider>.json; the
// workflow step scripts/check-providers.mjs turns the records into the
// actions above (`providerActions`, pure and tested).
//
// Nothing under api/_handlers flushes, so the live API never writes files;
// its calls only count in memory.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
// FMP and Yahoo are no longer asked anywhere (their terms do not cover a paid
// site); their labels stay so an old record still reads by name.
export const PROVIDERS = ['twelvedata', 'finnhub', 'openfigi'];
const LABEL = { fmp: 'FMP', twelvedata: 'TwelveData', finnhub: 'Finnhub', yahoo: 'Yahoo', openfigi: 'OpenFIGI' };
export const issueTitle = (name) => `Veri sağlayıcı reddediyor: ${LABEL[name] || name} (bilinen sorun)`;
export const KNOWN_ISSUE_LABELS = ['data-alarm', 'known-issue'];

const seen = new Map(); // provider -> { ok, refusals: [msg], errors }

// 401/402/403 and the plan wording: an account problem, not a blip. Running
// out of a daily quota (429, "credits") is normal and deliberately NOT here.
export const isRefusal = (msg) => /\b(401|402|403)\b|premium|subscription|upgrade your plan|invalid api key|not on this plan/i.test(String(msg || ''));

export function noteProvider(name, { ok = false, error = null, refused = false } = {}) {
  if (!seen.has(name)) seen.set(name, { ok: 0, refusals: [], errors: 0 });
  const s = seen.get(name);
  if (ok) s.ok++;
  else if (error && (refused || isRefusal(error))) {
    if (s.refusals.length < 20) s.refusals.push(String(error).slice(0, 200));
    s.refusedCount = (s.refusedCount || 0) + 1;
  } else if (error) s.errors++;
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
    // several builds in one workflow run (stock meta, then prices) write the
    // same record: a refusal earlier in the run must survive a later step
    const runId = process.env.GITHUB_RUN_ID || null;
    const sameRun = runId && prev.run_id === runId;
    const refusals = (s.refusedCount || 0) + (sameRun ? prev.refusals || 0 : 0);
    const calls = s.ok + (sameRun ? prev.calls_ok || 0 : 0);
    const firstMsg = s.refusals[0] || (sameRun ? String(prev.last_error || '').replace(/^\d+ refusal\(s\): /, '') : '');
    const refused = refusals > 0;
    const rec = {
      dataset: name,
      kind: 'provider',
      run_id: runId,
      last_run_at: now,
      last_success_at: !refused && calls ? now : prev.last_success_at || null,
      last_error: refused ? `${refusals} refusal(s): ${firstMsg}` : null,
      last_error_at: refused ? now : prev.last_error_at || null,
      calls_ok: calls,
      refusals,
      transient_errors: s.errors + (sameRun ? prev.transient_errors || 0 : 0),
    };
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(rec, null, 1));
    if (refused) log.warn(`::warning::${LABEL[name] || name} refused ${refusals} request(s) this run: ${firstMsg}`);
    out.push(rec);
  }
  seen.clear();
  return out;
}

// What to do with each provider record written in this run.
//   records     provider health records (see flushProviderHealth)
//   openTitles  titles of the open alarm issues
// → [{ provider, title, action }] with action
//   'open'     refusing and no issue yet — the one notification
//   'known'    refusing, issue already open — stay quiet, warn only
//   'resolve'  answering again with an issue open — announce recovery
//   'ok'       answering, nothing open
// A provider this run did not call has no record here and is left alone:
// "not asked" is not "recovered".
export function providerActions(records, openTitles) {
  const open = new Set(openTitles);
  const out = [];
  for (const r of records) {
    if (!r || r.kind !== 'provider') continue;
    const title = issueTitle(r.dataset);
    const refusing = (r.refusals || 0) > 0;
    const answering = !refusing && (r.calls_ok || 0) > 0;
    if (refusing) out.push({ provider: r.dataset, title, action: open.has(title) ? 'known' : 'open', detail: r.last_error });
    else if (answering) out.push({ provider: r.dataset, title, action: open.has(title) ? 'resolve' : 'ok' });
  }
  return out;
}
