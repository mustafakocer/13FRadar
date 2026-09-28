// Ops alarms: the GitHub issue is the channel.
//
// A data job that fails opens an issue labelled `data-alarm` and mentions the
// on-call account (repository variable ALERT_MENTION, default mustafakocer);
// GitHub emails that account because of the @mention, so nobody has to watch
// the repository's whole activity. The same alarm again is a comment on the
// open issue (mentioned again), and recovery closes it with a "çözüldü"
// comment. One open issue per alarm title, ever.
//
// Batch-only (GitHub Actions); `http` is injectable so tests never call GitHub.
import axios from 'axios';

export const DEFAULT_MENTION = 'mustafakocer';
export const ALARM_LABEL = 'data-alarm';

// "@user" from ALERT_MENTION; an empty variable falls back to the default.
export function mentionOf(env = process.env) {
  const u = String(env.ALERT_MENTION ?? '').trim().replace(/^@+/, '') || DEFAULT_MENTION;
  return /^[A-Za-z0-9-]{1,39}$/.test(u) ? `@${u}` : `@${DEFAULT_MENTION}`;
}

export function githubIssues({ token, repo, http = axios }) {
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required to raise an alarm');
  const gh = http.create({
    baseURL: `https://api.github.com/repos/${repo}`,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    validateStatus: () => true,
    timeout: 15000,
  });
  const ok = (r, what) => {
    if (r.status >= 300) throw new Error(`GitHub ${what}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    return r.data;
  };
  return {
    async openWithLabel(label) {
      return ok(await gh.get('/issues', { params: { state: 'open', labels: label, per_page: 100 } }), 'list issues');
    },
    async create(title, body, labels) {
      return ok(await gh.post('/issues', { title, body, labels }), 'create issue');
    },
    async comment(number, body) {
      return ok(await gh.post(`/issues/${number}/comments`, { body }), 'comment');
    },
    async close(number) {
      return ok(await gh.patch(`/issues/${number}`, { state: 'closed', state_reason: 'completed' }), 'close issue');
    },
  };
}

export async function findOpen(issues, title, label = ALARM_LABEL) {
  const list = await issues.openWithLabel(label);
  return (Array.isArray(list) ? list : []).find((i) => i.title === title) || null;
}

// Open the alarm, or comment on the one already open. Throws if GitHub refuses
// — the caller turns that into a red run, because an alarm nobody receives is
// the failure this module exists to prevent.
export async function raise(issues, { title, body, mention, labels = [ALARM_LABEL] }) {
  const text = `${mention}\n\n${body}`.slice(0, 60000);
  const open = await findOpen(issues, title, labels[0]);
  if (open) {
    await issues.comment(open.number, text);
    return { action: 'commented', number: open.number };
  }
  const created = await issues.create(title, text, labels);
  return { action: 'opened', number: created.number };
}

// Close the open alarm with a "çözüldü" comment; nothing to do when none is open.
export async function resolve(issues, { title, body = '', mention, label = ALARM_LABEL }) {
  const open = await findOpen(issues, title, label);
  if (!open) return { action: 'none' };
  await issues.comment(open.number, `${mention} çözüldü / resolved.${body ? `\n\n${body}` : ''}`);
  await issues.close(open.number);
  return { action: 'closed', number: open.number };
}
