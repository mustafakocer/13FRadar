// Start a workflow again on the branch's current code, once
// (stale-code-guard.mjs found the code changed while the run was building):
//
//   node scripts/rerun-workflow.mjs universe.yml
//
// The new run carries trigger=stale-retry; if the guard trips on that one
// too, the workflow raises its alarm instead of trying a third time.
// A workflow_dispatch sent with GITHUB_TOKEN does start a run (it needs
// `actions: write`).
export const RETRY_TRIGGER = 'stale-retry';

export function dispatchRequest({ repo, workflow, ref, token }) {
  return {
    url: `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`,
    init: {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' },
      body: JSON.stringify({ ref, inputs: { trigger: RETRY_TRIGGER } }),
    },
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const workflow = process.argv[2];
  const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token, GITHUB_REF_NAME: ref = 'main' } = process.env;
  if (!workflow || !repo || !token) {
    console.error('usage: GITHUB_REPOSITORY=… GITHUB_TOKEN=… node scripts/rerun-workflow.mjs <workflow file>');
    process.exit(2);
  }
  const { url, init } = dispatchRequest({ repo, workflow, ref, token });
  const r = await fetch(url, init);
  if (r.status !== 204) {
    console.error(`::error::could not start ${workflow} again: HTTP ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  console.log(`${workflow} started again on ${ref} (trigger=${RETRY_TRIGGER}): the data is rebuilt with the current code`);
}
