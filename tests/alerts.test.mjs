import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventId, diffFilings, pendingDeliveries, renderFundEmail, renderStockEmail, SPK_NOTICE } from '../api/_lib/alerts.js';

const P = (cusip, value, shares, weight, issuer = cusip, extra = {}) => ({ cusip, issuer, value, shares, weight, ...extra });

test('eventId: original vs amended filing', () => {
  assert.equal(eventId({ acc: 'A1' }), 'A1');
  assert.equal(eventId({ acc: 'A1', amendments: [{ acc: 'B1' }, { acc: 'B2' }] }), 'A1+B2');
});

test('diffFilings: buckets, puts ignored, no prev -> all NEW', () => {
  const prev = [P('AAPL', 1000, 100, 50), P('KO', 500, 100, 25), P('XOM', 500, 50, 25), P('AAPL', 10, 1, 1, 'AAPL', { putCall: 'Put' })];
  const cur = [P('AAPL', 1500, 150, 50), P('KO', 250, 50, 10), P('NVDA', 1000, 10, 40)];
  const d = diffFilings(prev, cur);
  assert.deepEqual(d.NEW.map((c) => c.cusip), ['NVDA']);
  assert.deepEqual(d.ADD.map((c) => c.cusip), ['AAPL']);
  assert.deepEqual(d.REDUCE.map((c) => c.cusip), ['KO']);
  assert.deepEqual(d.EXIT.map((c) => c.cusip), ['XOM']);
  assert.equal(d.total, 4);
  assert.ok(Math.abs(d.ADD[0].dSharesPct - 50) < 1e-9);
  const first = diffFilings(null, cur);
  assert.equal(first.NEW.length, 3);
  assert.equal(first.NEW[0].cusip, 'AAPL', 'largest first');
});

test('pendingDeliveries: dedupe on sent, retry failed up to 3 attempts, kind/key match', () => {
  const subs = [
    { user_id: 'u1', kind: 'fund', key: 'C1' },
    { user_id: 'u2', kind: 'fund', key: 'C1' },
    { user_id: 'u1', kind: 'stock', key: 'S1' },
  ];
  const events = [{ kind: 'fund', key: 'C1', eventId: 'E1' }, { kind: 'stock', key: 'S1', eventId: 'C9:E7' }];
  const delivered = [
    { user_id: 'u1', kind: 'fund', key: 'C1', event_id: 'E1', status: 'sent', attempts: 1 },
    { user_id: 'u2', kind: 'fund', key: 'C1', event_id: 'E1', status: 'failed', attempts: 1 },
  ];
  const p = pendingDeliveries(subs, events, delivered);
  assert.deepEqual(p.map((x) => `${x.user_id}|${x.kind}|${x.key}|${x.event_id}|${x.attempts}`), ['u2|fund|C1|E1|1', 'u1|stock|S1|C9:E7|0']);
  const exhausted = pendingDeliveries(subs, events, [{ user_id: 'u2', kind: 'fund', key: 'C1', event_id: 'E1', status: 'failed', attempts: 3 }, ...delivered.slice(0, 1)]);
  assert.equal(exhausted.some((x) => x.user_id === 'u2'), false);
  assert.equal(pendingDeliveries(subs, events, []).length, 3);
});

test('renderFundEmail: Turkish subject, SPK notice, escaping, truncation', () => {
  const diff = diffFilings(
    [P('KO', 500, 100, 25, 'COCA COLA')],
    [P('AAPL', 1500, 150, 60, 'APPLE <INC>', { ticker: 'AAPL' }), ...Array.from({ length: 10 }, (_, i) => P(`N${i}`, 100 - i, 1, 1, `NEW ${i}`))]
  );
  const m = renderFundEmail({ fundName: 'Berkshire', cik: '0001067983', reportDate: '2026-06-30', filingDate: '2026-08-14', aum: 3e11, positions: 11, diff, siteUrl: 'https://x.test' });
  assert.match(m.subject, /^Berkshire: 2026 Ç2 13F açıklandı — 11 yeni, 1 çıkış$/);
  assert.ok(m.html.includes(SPK_NOTICE) && m.text.includes(SPK_NOTICE));
  assert.ok(m.html.includes('APPLE &lt;INC&gt;'), 'html escaped');
  assert.ok(m.text.includes('… ve 3 tane daha'), 'truncated to 8 per bucket');
  assert.ok(m.html.includes('https://x.test/manager/0001067983'));
  const empty = renderFundEmail({ fundName: 'F', cik: '1', reportDate: '2026-03-31', filingDate: '2026-05-15', aum: 1, positions: 0, diff: diffFilings([], []), siteUrl: 's' });
  assert.ok(empty.text.includes('pozisyon değişikliği yok'));
});

test('renderStockEmail', () => {
  const change = { cusip: 'C', issuer: 'APPLE INC', ticker: 'AAPL', action: 'REDUCE', value: 5e9, weight: 12.3, dSharesPct: -25 };
  const m = renderStockEmail({ ticker: 'AAPL', issuer: 'APPLE INC', cusip: 'C', fundName: 'Berkshire', cik: '1', reportDate: '2026-06-30', filingDate: '2026-08-14', change, siteUrl: 'https://x.test' });
  assert.equal(m.subject, "AAPL: Berkshire 2026 Ç2'de azalttı");
  assert.ok(m.text.includes('-25.0% hisse'));
  assert.ok(m.html.includes('https://x.test/stock/AAPL?cusip=C'));
});
