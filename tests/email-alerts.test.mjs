// The email digest, back on (docs/EMAIL_ALERTS.md): a real run without a
// mail key reads nobody and exits 1; a dry run reads, matches against the
// watchlist, prints with the address masked and moves no mark; a real run
// sends through Resend and moves the reader's marks once.
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

const USER = '00000000-0000-4000-8000-00000000000a';
// the real filings.json's newest row: whatever fund filed last, the test
// puts it on the reader's watchlist with the mark one day before
const filings = JSON.parse(fs.readFileSync(path.join(root, 'client', 'public', 'filings.json'), 'utf8')).rows;
const newest = filings[0];
const dayBefore = new Date(Date.parse(`${newest.filed}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

// A stand-in Supabase REST + Resend that records every request.
function stub() {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      hits.push({ method: req.method, url: req.url, body });
      res.setHeader('content-type', 'application/json');
      if (req.url.startsWith('/rest/v1/notification_prefs') && req.method === 'GET')
        return res.end(JSON.stringify([{ user_id: USER, email_digest: true, digest_frequency: 'daily', lang: 'tr', filings_seen: dayBefore, filings_seen_acc: [], form4_seen: dayBefore, last_sent_at: null }]));
      if (req.url.startsWith('/rest/v1/watchlists')) return res.end(JSON.stringify([{ user_id: USER, cik: newest.cik, name: newest.name }]));
      if (req.url.startsWith('/rest/v1/alerts') && req.method === 'GET') return res.end('[]');
      if (req.url.startsWith('/rest/v1/profiles')) return res.end(JSON.stringify([{ id: USER, email: 'reader@example.test' }]));
      if (req.url.startsWith('/emails')) return res.end(JSON.stringify({ id: 'em_1' }));
      res.end('[]');
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, hits, url: `http://127.0.0.1:${server.address().port}` })));
}

test('a real run without RESEND_API_KEY exits 1 before reading anyone', async () => {
  const { server, hits, url } = await stub();
  try {
    const r = await run([], { SUPABASE_URL: url, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-role', RESEND_API_KEY: '', ALERT_FROM: '' });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /RESEND_API_KEY/);
    assert.deepEqual(hits, [], 'nothing was read');
  } finally {
    server.close();
  }
});

test('a dry run matches the watchlist, masks the address and moves no mark', async () => {
  const { server, hits, url } = await stub();
  try {
    const r = await run(['--dry-run'], { SUPABASE_URL: url, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-role', RESEND_API_KEY: '', SITE_URL: 'https://example.test' });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[dry run\]/);
    assert.match(r.out, /r\*\*\*@example\.test/, 'address masked');
    assert.ok(!r.out.includes('reader@example.test'), 'full address never printed');
    assert.ok(r.out.includes(newest.name), `the watched fund's filing is in the digest:\n${r.out}`);
    assert.match(r.out, /yeni 13F/, 'written in the reader’s language');
    assert.match(r.out, /https:\/\/example\.test\/tr\//, 'links carry the site and the language');
    assert.ok(!hits.some((h) => h.method === 'PATCH'), 'no mark moved on a dry run');
    assert.ok(!hits.some((h) => h.url.startsWith('/emails')), 'nothing sent on a dry run');
  } finally {
    server.close();
  }
});

test('a real run sends once and moves the reader’s filing mark to the newest day with its accessions', async () => {
  const { server, hits, url } = await stub();
  try {
    // Resend is reached through the same stub: the script posts to
    // https://api.resend.com — pointed at the stub by the proxy env below
    const r = await run([], {
      SUPABASE_URL: url, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service-role',
      RESEND_API_KEY: 're_test', ALERT_FROM: 'Fundocap <alerts@example.test>', RESEND_BASE_URL: url,
    });
    assert.equal(r.code, 0, r.out);
    const sends = hits.filter((h) => h.url.startsWith('/emails'));
    assert.equal(sends.length, 1, 'one email');
    const mail = JSON.parse(sends[0].body);
    assert.deepEqual(mail.to, ['reader@example.test']);
    assert.match(mail.subject, /yeni 13F/);
    const patch = hits.find((h) => h.method === 'PATCH' && h.url.startsWith('/rest/v1/notification_prefs'));
    assert.ok(patch, 'the reader’s marks were moved');
    const fields = JSON.parse(patch.body);
    assert.equal(fields.filings_seen, newest.filed);
    assert.ok(fields.filings_seen_acc.includes(newest.acc));
    assert.ok(fields.last_sent_at);
  } finally {
    server.close();
  }
});

test('the digest workflow is scheduled again and gated on both keys', () => {
  const yml = fs.readFileSync(path.join(root, '.github', 'workflows', 'alerts.yml'), 'utf8');
  assert.match(yml, /^\s*schedule:/m);
  assert.match(yml, /RESEND_API_KEY \/ ALERT_FROM not configured/);
  assert.ok(!/removed in 2026-09/.test(yml));
});
