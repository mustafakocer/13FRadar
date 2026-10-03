// One Finnhub key, two nightly builds: the price build (consensus.yml) and
// the insider build (insiders.yml) never call it at the same time. Before
// its Finnhub step each asks GitHub whether the other workflow has a run in
// progress: the price build waits for it (its run is short), the insider
// build skips its top-up and leaves it to its next run.
//
// GITHUB_REPOSITORY, GITHUB_TOKEN (actions: read) and FINNHUB_PEER_WORKFLOW
// (the other workflow's file) come from the workflow; without them nothing
// is checked.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function peerRunning({ repo = process.env.GITHUB_REPOSITORY, token = process.env.GITHUB_TOKEN, workflow = process.env.FINNHUB_PEER_WORKFLOW, fetchImpl = fetch } = {}) {
  if (!repo || !token || !workflow) return { running: false, checked: false };
  const runs = [];
  for (const status of ['in_progress', 'queued']) {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?status=${status}&per_page=5`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
    });
    if (!r.ok) return { running: false, checked: false, error: `HTTP ${r.status}` };
    const j = await r.json();
    if (status === 'in_progress') runs.push(...(j.workflow_runs || []));
  }
  return { running: runs.length > 0, checked: true, runs: runs.map((x) => x.id) };
}

// Wait while the peer runs, polling every `everyMs`, at most `maxMs`.
// Returns { waitedMs, clear } — clear false means the peer still runs.
export async function waitForPeer({ maxMs = 20 * 60000, everyMs = 30000, log = console.log, check = peerRunning, wait = sleep } = {}) {
  let waitedMs = 0;
  for (;;) {
    const p = await check();
    if (!p.running) {
      if (waitedMs) log(`finnhub: ${process.env.FINNHUB_PEER_WORKFLOW || 'the other build'} finished, going on after ${Math.round(waitedMs / 1000)} s`);
      return { waitedMs, clear: true, checked: p.checked };
    }
    if (waitedMs >= maxMs) return { waitedMs, clear: false, checked: true };
    if (!waitedMs) log(`finnhub: ${process.env.FINNHUB_PEER_WORKFLOW} is running (run ${p.runs.join(', ')}) — waiting for it before calling Finnhub`);
    await wait(everyMs);
    waitedMs += everyMs;
  }
}
