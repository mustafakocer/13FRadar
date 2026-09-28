// Email alerts are removed (docs/EMAIL_ALERTS.md). Even run by hand, with
// every key present, the digest must read nothing, send nothing and — above
// all — mark nothing as sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root } from './helpers.mjs';

function run(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['scripts/send-alerts.mjs', ...args], { cwd: root, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}

test('a hand-run of the digest says "email alerts are removed" and touches nothing', async () => {
  // a stand-in Supabase that records every request it gets
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.setHeader('content-type', 'application/json');
    res.end('[]');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const env = {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    RESEND_API_KEY: 're_test',
    ALERT_FROM: 'Fundocap <alerts@example.test>',
  };
  try {
    for (const args of [[], ['--force'], ['--dry-run']]) {
      const r = await run(args, env);
      assert.equal(r.code, 0, r.out);
      assert.match(r.out, /email alerts are removed/);
    }
    assert.deepEqual(hits, [], 'no read, no PATCH of last_seen / last_fired_at — nothing is consumed');
  } finally {
    server.close();
  }
});

test('the digest workflow has no schedule left, only a hand-run', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'alerts.yml'), 'utf8');
  assert.ok(!/^\s*schedule:/m.test(yml), 'no schedule');
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /removed in 2026-09/);
});

test('no page still offers email alerts', () => {
  const i18n = fs.readFileSync(path.join(root, 'client', 'src', 'i18n.jsx'), 'utf8');
  for (const gone of ["'alerts.save'", "'alerts.email'", "'watchlist.alertEnable'", 'e-posta bildirimi', 'email alert when', 'never miss a new filing'])
    assert.ok(!i18n.includes(gone), `${gone} is still in i18n.jsx`);
  for (const page of ['Insiders.jsx', 'Account.jsx', 'Watchlist.jsx'])
    assert.ok(!/useAlerts/.test(fs.readFileSync(path.join(root, 'client', 'src', 'pages', page), 'utf8')), `${page} still uses useAlerts`);
});
