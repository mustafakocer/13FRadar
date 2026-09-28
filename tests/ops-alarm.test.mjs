// Ops alarms go to a GitHub issue that @mentions the on-call account: one
// issue per alarm, comments while it lasts, closed with "çözüldü" on recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { githubIssues, mentionOf, raise, resolve } from '../api/_lib/opsAlarm.js';
import { fakeGitHub } from './fixtures/fake-github.mjs';

test('mention comes from ALERT_MENTION, defaulting to mustafakocer', () => {
  assert.equal(mentionOf({}), '@mustafakocer');
  assert.equal(mentionOf({ ALERT_MENTION: '' }), '@mustafakocer', 'an empty repository variable is the default');
  assert.equal(mentionOf({ ALERT_MENTION: '@someone-else' }), '@someone-else');
  assert.equal(mentionOf({ ALERT_MENTION: 'not a login!' }), '@mustafakocer', 'garbage never becomes a mention');
});

test('one issue per alarm: opened once, commented while it lasts, closed with "çözüldü"', async () => {
  const gh = fakeGitHub();
  const issues = githubIssues({ token: 't', repo: 'o/r', http: gh.http });
  const m = '@mustafakocer';
  assert.deepEqual(await raise(issues, { title: 'Insider ingest failed', body: 'day 1', mention: m }), { action: 'opened', number: 1 });
  assert.deepEqual(await raise(issues, { title: 'Insider ingest failed', body: 'day 2', mention: m }), { action: 'commented', number: 1 });
  assert.equal(gh.issues.length, 1, 'no second issue');
  assert.ok(gh.issues[0].body.startsWith('@mustafakocer'), 'the issue mentions the on-call account');
  assert.ok(gh.issues[0].comments[0].startsWith('@mustafakocer'), 'so does every comment');
  assert.deepEqual(gh.issues[0].labels, ['data-alarm']);

  assert.deepEqual(await resolve(issues, { title: 'Insider ingest failed', mention: m }), { action: 'closed', number: 1 });
  assert.equal(gh.issues[0].state, 'closed');
  assert.match(gh.issues[0].comments.at(-1), /^@mustafakocer çözüldü/);
  assert.deepEqual(await resolve(issues, { title: 'Insider ingest failed', mention: m }), { action: 'none' }, 'nothing open, nothing to do');

  // a different alarm gets its own issue
  await raise(issues, { title: 'Data freshness check failed', body: 'x', mention: m });
  assert.equal(gh.issues.length, 2);
});

test('GitHub refusing the issue is an error the caller must surface', async () => {
  const gh = fakeGitHub({ failWith: 403 });
  const issues = githubIssues({ token: 't', repo: 'o/r', http: gh.http });
  await assert.rejects(raise(issues, { title: 'x', body: 'y', mention: '@a' }), /HTTP 403/);
  assert.throws(() => githubIssues({ token: '', repo: 'o/r' }), /GITHUB_TOKEN/);
});
