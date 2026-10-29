// Lead magnets end to end, with Supabase (the subscribers table) and Resend
// replaced by local HTTP stand-ins: double opt-in, the rate limit, the
// honeypot, signed download grants, the Excel files, unsubscribe, the
// newsletter builder and the portfolio matcher.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';

const read = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => resolve(b));
});
const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

// ---- Supabase stand-in: just the subscribers table ---------------------------
const rows = new Map();
let seq = 0;
const supabase = http.createServer(async (req, res) => {
  const body = await read(req);
  const u = new URL(req.url, 'http://x');
  if (req.headers.authorization !== 'Bearer svc-key') return json(res, 401, {});
  if (u.pathname !== '/rest/v1/subscribers') return json(res, 404, {});
  const eq = [...u.searchParams].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
  const match = (r) => eq.every(([k, v]) => String(r[k]) === v);
  if (req.method === 'GET') return json(res, 200, [...rows.values()].filter(match));
  if (req.method === 'POST') {
    const row = { id: `id-${++seq}`, status: 'pending', newsletter: false, gurus: [], magnets: [], confirm_sends: 0, ...JSON.parse(body) };
    if ([...rows.values()].some((r) => r.email === row.email)) return json(res, 409, { code: '23505' });
    rows.set(row.id, row);
    return json(res, 201, [row]);
  }
  if (req.method === 'PATCH') {
    for (const r of [...rows.values()].filter(match)) Object.assign(r, JSON.parse(body));
    res.writeHead(204);
    return res.end();
  }
  json(res, 405, {});
});

// ---- Resend stand-in ----------------------------------------------------------
const mails = [];
const resend = http.createServer(async (req, res) => {
  mails.push(JSON.parse(await read(req)));
  json(res, 200, { id: `mail-${mails.length}` });
});

const listen = (srv) => new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${srv.address().port}`)));
process.env.SUPABASE_URL = await listen(supabase);
process.env.SUPABASE_ANON_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-key';
process.env.RESEND_API_KEY = 're_test';
process.env.LEAD_FROM = 'Fundocap <bulten@fundocap.test>';
process.env.RESEND_BASE_URL = await listen(resend);
process.env.SITE_URL = 'https://www.fundocap.test';
delete process.env.META_PIXEL_ID;

const L = await import('../api/_lib/leads.js');
const { subscribe, confirm, unsubscribe, leadFile } = await import('../api/_handlers/leads.js');
const { matchPortfolio, cleanTickers } = await import('../api/_lib/portfolioMatch.js');
const { buildNewsletter, renderNewsletter } = await import('../api/_lib/newsletter.js');
const { consensusCsv, insiderBuysCsv } = await import('../api/_lib/leadFiles.js');

test.after(() => {
  supabase.close();
  resend.close();
});

function call(handler, { method = 'GET', query = {}, body } = {}) {
  const raw = body ? JSON.stringify(body) : '';
  const req = Readable.from(raw ? [Buffer.from(raw)] : []);
  Object.assign(req, { method, query, body: body || undefined, headers: { host: 'www.fundocap.test', 'x-forwarded-for': '203.0.113.9' } });
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
      },
      status(c) {
        this.statusCode = c;
        return this;
      },
      json(b) {
        resolve({ status: this.statusCode, body: b, headers: this.headers });
      },
      send(b) {
        resolve({ status: this.statusCode, body: b, headers: this.headers });
      },
      writeHead(c, h) {
        this.statusCode = c;
        Object.assign(this.headers, Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v])));
        return this;
      },
      end() {
        resolve({ status: this.statusCode, headers: this.headers });
      },
    };
    handler(req, res);
  });
}

// ---- pure rules ---------------------------------------------------------------
test('magnets, addresses, merge and the confirmation rate limit', () => {
  assert.deepEqual(L.parseMagnet('Report:2026-Q2'), { id: 'report:2026-q2', kind: 'report', report: '2026-q2' });
  assert.deepEqual(L.parseMagnet('guru:1067983'), { id: 'guru:0001067983', kind: 'guru', cik: '0001067983' });
  assert.equal(L.parseMagnet('report:2026'), null);
  assert.equal(L.parseMagnet('../etc/passwd'), null);
  assert.equal(L.normalizeEmail('  Reader@Example.COM '), 'reader@example.com');
  assert.equal(L.normalizeEmail('not-an-email'), null);
  const m = L.mergeRequest({ magnets: ['newsletter'], gurus: ['0001067983'], newsletter: true, status: 'confirmed' }, { magnet: L.parseMagnet('guru:0002026053'), newsletter: false });
  assert.deepEqual(m, { magnets: ['newsletter', 'guru:0002026053'], gurus: ['0001067983', '0002026053'], newsletter: true });
  const now = Date.parse('2026-10-26T10:00:00Z');
  assert.deepEqual(L.confirmAllowed(null, now), { ok: true, sends: 1 });
  assert.equal(L.confirmAllowed({ confirm_sent_at: '2026-10-26T09:59:30Z', confirm_sends: 1 }, now).reason, 'too-soon');
  assert.equal(L.confirmAllowed({ confirm_sent_at: '2026-10-26T09:00:00Z', confirm_sends: 3 }, now).reason, 'daily-cap');
  assert.deepEqual(L.confirmAllowed({ confirm_sent_at: '2026-10-25T09:00:00Z', confirm_sends: 3 }, now), { ok: true, sends: 1 });
});

test('download grants: signed, expiring, tamper-proof', () => {
  const g = L.signGrant();
  assert.ok(L.verifyGrant(g));
  assert.equal(L.verifyGrant(g.slice(0, -1) + (g.endsWith('A') ? 'B' : 'A')), false);
  assert.equal(L.verifyGrant(`${Number(g.split('.')[0]) + 1}.${g.split('.')[1]}`), false);
  assert.equal(L.verifyGrant(L.signGrant(Date.now() - 31 * 86400 * 1000)), false, 'expired after 30 days');
  assert.equal(L.verifyGrant(''), false);
});

// ---- the flow -----------------------------------------------------------------
test('subscribe → confirmation mail → confirm → delivery mail + thanks redirect → download → unsubscribe', async () => {
  const r1 = await call(subscribe, { method: 'POST', body: { email: 'Reader@Example.com', magnet: 'xl-consensus', lang: 'tr', newsletter: true } });
  assert.deepEqual(r1, { status: 200, body: { ok: true, status: 'pending' }, headers: r1.headers });
  const row = [...rows.values()][0];
  assert.equal(row.email, 'reader@example.com');
  assert.equal(row.status, 'pending');
  assert.equal(row.newsletter, true);
  assert.deepEqual(row.magnets, ['xl-consensus']);
  assert.ok(row.consent_text && row.consent_ip === '203.0.113.9');
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /E-postanı onayla/);
  const link = /https:\/\/www\.fundocap\.test\/api\/subscribe-confirm\?t=([A-Za-z0-9_-]+)/.exec(mails[0].text);
  assert.ok(link, 'confirmation link in the mail');

  // a second request inside a minute: answered the same, no second mail
  await call(subscribe, { method: 'POST', body: { email: 'reader@example.com', magnet: 'xl-consensus', lang: 'tr' } });
  assert.equal(mails.length, 1, 'rate limited');

  const c = await call(confirm, { query: { t: link[1] } });
  assert.equal(c.status, 302);
  assert.match(c.headers.location, /^\/tr\/thanks\?m=xl-consensus&g=\d+\.[A-Za-z0-9_-]{32}$/);
  assert.equal(row.status, 'confirmed');
  assert.equal(row.confirm_token, null);
  assert.equal(mails.length, 2);
  assert.match(mails[1].text, /lead-file\?f=xl-consensus&g=/);
  assert.match(mails[1].text, /Abonelikten çık: https:\/\/www\.fundocap\.test\/api\/unsubscribe\?t=/);
  assert.equal(mails[1].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  // the link is single-use
  const again = await call(confirm, { query: { t: link[1] } });
  assert.match(again.headers.location, /thanks\?e=expired/);

  const g = new URLSearchParams(c.headers.location.split('?')[1]).get('g');
  const f = await call(leadFile, { query: { f: 'xl-consensus', g } });
  assert.equal(f.status, 200);
  assert.match(f.headers['content-type'], /text\/csv/);
  assert.match(f.body, /^﻿Rank,Ticker,Company/);
  assert.equal((await call(leadFile, { query: { f: 'xl-consensus', g: 'nope' } })).status, 403);
  const pdf = await call(leadFile, { query: { f: 'report:2026-q2', l: 'en', g } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');

  // GET only redirects to the page (link scanners); POST unsubscribes
  const get = await call(unsubscribe, { query: { t: row.unsub_token } });
  assert.equal(get.status, 302);
  assert.equal(get.headers.location, `/tr/unsubscribe?t=${row.unsub_token}`);
  assert.equal(row.status, 'confirmed');
  const post = await call(unsubscribe, { method: 'POST', query: { t: row.unsub_token } });
  assert.equal(post.status, 200);
  assert.equal(row.status, 'unsubscribed');
  assert.equal(row.newsletter, false);
});

test('a confirmed reader asking again gets the file mailed without a new confirmation; bots and bad input get nothing', async () => {
  rows.clear();
  mails.length = 0;
  rows.set('id-c', { id: 'id-c', email: 'fan@example.com', lang: 'en', status: 'confirmed', newsletter: false, gurus: [], magnets: ['newsletter'], unsub_token: 'unsub-token-fan-000000000000' });
  const r = await call(subscribe, { method: 'POST', body: { email: 'fan@example.com', magnet: 'xl-insiders', lang: 'en' } });
  assert.equal(r.body.status, 'sent');
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /Here you go/);
  assert.match(mails[0].text, /lead-file\?f=xl-insiders/);
  assert.doesNotMatch(mails[0].text, /Weekly Smart Money Newsletter/, 'only the magnet just asked for');

  const bot = await call(subscribe, { method: 'POST', body: { email: 'bot@example.com', magnet: 'newsletter', website: 'http://spam' } });
  assert.deepEqual(bot.body, { ok: true });
  assert.equal((await call(subscribe, { method: 'POST', body: { email: 'x', magnet: 'newsletter' } })).status, 400);
  assert.equal((await call(subscribe, { method: 'POST', body: { email: 'a@b.co', magnet: 'everything' } })).status, 400);
  assert.equal((await call(subscribe, { body: { email: 'a@b.co', magnet: 'newsletter' } })).status, 405);
  assert.equal(mails.length, 1);
  assert.ok(![...rows.values()].some((x) => x.email === 'bot@example.com'));
});

// ---- content ------------------------------------------------------------------
test('the Excel magnets are the top 50 and the last 30 days of insider buys', () => {
  const table = { quarter: '2026-06-30', stocks: Array.from({ length: 60 }, (_, i) => ({ rank: 60 - i, ticker: `T${i}`, issuer: `Co ${i}`, holderCount: 3, totalValue: 1e9, holders: [{ name: 'Fund A' }] })) };
  const c = consensusCsv(table);
  assert.equal(c.rows, 50);
  assert.match(c.csv.split('\n')[1], /^1,T59,/);
  const now = new Date('2026-10-26T00:00:00Z');
  const b = insiderBuysCsv(
    [
      { k: 'P', t: 'AAA', n: 'X', r: 'ceo', d: '2026-10-20', f: '2026-10-21', s: 10, p: 5, v: 50 },
      { k: 'P', t: 'BBB', n: 'Y', r: 'director', d: '2026-10-20', f: '2026-10-21', s: 10, p: 50, v: 500 },
      { k: 'S', t: 'CCC', n: 'Z', r: 'ceo', d: '2026-10-20', f: '2026-10-21', s: 10, p: 50, v: 900 },
      { k: 'P', t: 'DDD', n: 'W', r: 'ceo', d: '2026-08-01', f: '2026-08-02', s: 10, p: 50, v: 999 },
      { k: 'P', t: null, ci: '0001959604', n: 'V', r: 'owner10', d: '2026-10-20', f: '2026-10-21', s: 10, p: 5, v: 40 },
    ],
    now
  );
  assert.equal(b.rows, 3);
  assert.match(b.csv.split('\n')[1], /,BBB,/);
  assert.match(b.csv, /,,CIK 1959604,V,/, 'an unmapped issuer is named by its CIK, not left blank');
});

test('portfolio matcher: tickers cleaned, gurus ranked by coverage and weight, three free', () => {
  assert.deepEqual(cleanTickers('aapl, brk-b; msft  msft $$$'), ['AAPL', 'BRK.B', 'MSFT']);
  const h = (cik, name, weight) => ({ cik, name, weight });
  const table = {
    quarter: '2026-06-30',
    stocks: [
      { ticker: 'AAPL', issuer: 'APPLE', holderCount: 3, holders: [h('1', 'Buffett', 22), h('2', 'Duan', 41), h('3', 'Tiny', 0.01)] },
      { ticker: 'KO', issuer: 'COCA COLA', holderCount: 1, holders: [h('1', 'Buffett', 11)] },
      { ticker: 'BRK.B', issuer: 'BERKSHIRE', holderCount: 2, holders: [h('2', 'Duan', 24), h('4', 'Other', 5)] },
      { ticker: 'MSFT', issuer: 'MICROSOFT', holderCount: 1, holders: [h('5', 'Fifth', 3)] },
    ],
  };
  const r = matchPortfolio('AAPL KO BRK-B ZZZ', { table, pathOf: (c) => `/manager/${c}` });
  assert.equal(r.total, 3, 'a 0.01% position does not count');
  assert.deepEqual(r.matches.map((m) => m.name), ['Duan', 'Buffett', 'Other']);
  assert.deepEqual(r.matches[0], { cik: '2', name: 'Duan', path: '/manager/2', shared: [{ ticker: 'AAPL', weight: 41 }, { ticker: 'BRK.B', weight: 24 }], coverage: 50, guruWeight: 65, score: 56 });
  assert.equal(r.tickers.find((x) => x.ticker === 'ZZZ').holders, 0);
  assert.equal(matchPortfolio('AAPL KO BRK.B MSFT', { table, pathOf: String }).matches.length, 3);
  assert.equal(matchPortfolio('AAPL KO BRK.B MSFT', { table, full: true, pathOf: String }).matches.length, 4);
});

test('newsletter: this week only, one line per member, no advice words, unsubscribe in both parts', () => {
  const now = new Date('2026-10-26T05:00:00Z');
  const issue = buildNewsletter({
    now,
    lang: 'tr',
    site: 'https://www.fundocap.test',
    teaser: {
      signals: {
        cluster: [
          { t: 'OLD', c: 'Old Co', insiders: 9, v: 9e6, last: '2026-10-01' },
          { t: 'RAPP', c: 'Rapport', insiders: 6, v: 1.7e6, last: '2026-10-22' },
        ],
        csuite: [{ t: 'APLD', c: 'Applied Digital', n: 'Cummins Wes', r: 'ceo', v: 1e6, f: '2026-10-23' }],
      },
    },
    congress: {
      members: { A: { n: 'Jane Doe', p: 'D', st: 'IL', slug: 'jane-doe' } },
      rows: [
        { m: 'A', t: 'DDOG', k: 'buy', at: 'stock', f: '2026-10-22', lo: 50001, hi: 100000 },
        { m: 'A', t: 'EL', k: 'buy', at: 'stock', f: '2026-10-22', lo: 15001, hi: 50000 },
        { m: 'A', t: 'NVDA', k: 'sell', at: 'stock', f: '2026-10-22', lo: 1, hi: 2 },
      ],
    },
    filings: [{ cik: '0001067983', filed: '2026-10-24' }],
    gurus: [{ cik: '0001067983', name: 'Berkshire Hathaway (Warren Buffett)' }],
  });
  assert.match(issue.subject, /RAPP/);
  const titles = issue.sections.map((s) => s.title);
  assert.equal(titles.length, 4);
  assert.equal(issue.sections[0].items.length, 1, 'the old cluster is out of the week');
  assert.equal(issue.sections[2].items.length, 1, 'one line per member');
  const { text, html } = renderNewsletter(issue, { unsub: 'https://u/x', footer: 'Abonelikten çık: https://u/x' });
  assert.match(text, /https:\/\/u\/x/);
  assert.match(html, /href="https:\/\/u\/x"/);
  assert.doesNotMatch(text.toLowerCase(), /(^|\s)(al|sat|satın al)[!.]?(\s|$)|tavsiye ediyoruz|hedef fiyat/u);
  assert.match(text, /yatırım tavsiyesi değildir/);
});

test('confirmation mail: the button sits where the link was, not after the footer', async () => {
  const { confirmMail } = await import('../api/_lib/leads.js');
  const url = 'https://www.fundocap.co/api/subscribe-confirm?t=abc';
  const { html, text } = confirmMail({ lang: 'tr', magnet: { id: 'newsletter', kind: 'newsletter' }, newsletter: true, confirmUrl: url });
  assert.ok(text.includes(url));
  const btn = html.indexOf('E-postamı onayla');
  assert.ok(btn > html.indexOf('E-postanı onayla:'), 'button after the prompt');
  assert.ok(btn < html.indexOf('Bunu sen istemediysen'), 'button before the rest of the text');
  assert.ok(!/<br><br><br>/.test(html), 'no blank gap where the link used to be');
});
