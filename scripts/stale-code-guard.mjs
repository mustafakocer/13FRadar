// Run by every data workflow between `git pull --rebase` and `git push`:
// did the code that produces the data change on the branch while this run
// was building it? Then the data was made by the old code and must not land
// on top of the new code's.
//
// 2026-10-02: the universe build's GitHub fallback started at 07:05 on a
// commit from before PR #50 and #56, built for 50 minutes, rebased with
// -X theirs and pushed: universe.json and universe-summary.json went back to
// the old definition ($79.6T, options and stale funds counted).
//
// Exit 1 (nothing is pushed; the workflow's alarm opens) when any file under
// the paths below differs between the commit the run checked out
// (GITHUB_SHA) and HEAD after the rebase. The data commit itself touches none
// of them.
import { execFileSync } from 'node:child_process';

export const CODE_PATHS = ['scripts', 'api/_lib', 'config', '.github/workflows', 'package.json', 'package-lock.json'];

export function changedCode(from, to = 'HEAD', run = (args) => execFileSync('git', args, { encoding: 'utf8' })) {
  if (!from) return [];
  return run(['diff', '--name-only', from, to, '--', ...CODE_PATHS])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const from = process.env.GITHUB_SHA;
  if (!from) {
    console.log('stale-code guard: no GITHUB_SHA, nothing to compare');
    process.exit(0);
  }
  const changed = changedCode(from);
  if (!changed.length) {
    console.log(`stale-code guard: the code is the same as at ${from.slice(0, 8)}`);
    process.exit(0);
  }
  console.log(`::error::The code changed on the branch during this run (${from.slice(0, 8)} → HEAD): the data was built with the old code and is not pushed. The next run rebuilds it.`);
  for (const f of changed.slice(0, 40)) console.log(`  ${f}`);
  process.exit(1);
}
