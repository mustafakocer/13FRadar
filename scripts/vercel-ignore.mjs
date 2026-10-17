// Vercel's "Ignored Build Step" (vercel.json → ignoreCommand): should this
// push be built? Exit 0 skips the build, exit 1 builds — Vercel's convention.
//
// Every push builds the site, and a build is most of the hosting bill
// (CLAUDE.md: ~75% of usage). The data jobs commit to main 6–7 times a day.
// Logos, company domains and Congress trades change nothing a reader needs
// within hours, so a commit that only refreshes those is not deployed on its
// own: the next deployed commit (the insider runs at ~03:00 and ~11:00 UTC,
// the nightly consensus, any merge) carries its files, because a deployment
// always builds the whole of main.
//
// Everything else builds: code, merges, the consensus / insider / 13F
// universe / foreign-issuer data, and every preview. A skipped commit is
// built anyway when the last deployment is more than MAX_WAIT_HOURS old, or
// when anything in doubt (no previous deployment to compare with, a file
// outside the data folders) — a wasted build costs cents, a stale site more.
import { execFileSync } from 'node:child_process';

const MAX_WAIT_HOURS = 12;
const DEFERRABLE = [
  /^chore: refresh company domains\b/,
  /^chore: refresh stock logos\b/,
  /^chore: refresh Congress trading data\b/,
  /^chore: Congress data with SEC industry codes\b/,
];
// what those jobs write; a file anywhere else means the push is not data-only
const DATA_PATHS = [/^api\/_data\//, /^client\/public\//];

const env = process.env;
const say = (m) => console.log(`vercel-ignore: ${m}`);
const build = (why) => {
  say(`build — ${why}`);
  process.exit(1);
};
const skip = (why) => {
  say(`skip — ${why}`);
  process.exit(0);
};
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

export function decide({ vercelEnv, message, previousSha, changedFiles, previousAt, now = Date.now() }) {
  if (vercelEnv !== 'production') return ['build', `${vercelEnv || 'unknown'} deployment`];
  const subject = String(message || '').split('\n')[0];
  if (!DEFERRABLE.some((re) => re.test(subject))) return ['build', `"${subject}" is not a deferrable data refresh`];
  if (!previousSha) return ['build', 'no previous deployment to compare with'];
  if (!changedFiles) return ['build', `previous deployment ${previousSha.slice(0, 7)} not in the clone`];
  const other = changedFiles.filter((f) => !DATA_PATHS.some((re) => re.test(f)));
  if (other.length) return ['build', `files outside the data folders changed: ${other.slice(0, 3).join(', ')}`];
  if (!(previousAt > 0)) return ['build', 'age of the previous deployment unknown'];
  const hours = (now - previousAt) / 3600000;
  if (hours > MAX_WAIT_HOURS) return ['build', `last deployment ${hours.toFixed(1)} h old`];
  return ['skip', `"${subject}" waits for the next deployment (last one ${hours.toFixed(1)} h ago)`];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const previousSha = env.VERCEL_GIT_PREVIOUS_SHA || '';
  let changedFiles = null;
  let previousAt = null;
  if (previousSha) {
    try {
      changedFiles = git('diff', '--name-only', previousSha, 'HEAD').split('\n').filter(Boolean);
      previousAt = Number(git('log', '-1', '--format=%ct', previousSha)) * 1000;
    } catch {
      // a shallow clone without the previous deployment's commit
      changedFiles = null;
    }
  }
  const [verdict, why] = decide({ vercelEnv: env.VERCEL_ENV, message: env.VERCEL_GIT_COMMIT_MESSAGE, previousSha, changedFiles, previousAt });
  if (verdict === 'skip') skip(why);
  build(why);
}
