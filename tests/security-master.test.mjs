import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// #7 — one security master behind every CUSIP → ticker lookup.
// The master is pointed at a scratch file so nothing here touches the
// committed table.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fundocap-master-'));
process.env.SECURITY_MASTER_FILE = path.join(tmp, 'security-master.json');

const master = await import('../api/_lib/securityMaster.js');
const figi = await import('../api/_lib/figi.js');
const { resolveQuarters, resolveTimeHeld, findPositionByTicker, resolveSymbols } = await import('../api/_lib/historyResolve.js');
const { turnover } = await import('../api/_lib/turnover.js');
const { securityLabel, shortIssuer } = await import('../client/src/lib/label.js');

// Each test starts from a known table: seed() writes it and drops the
// in-memory copy; seedFromFlat() starts from the committed flat map.
const seed = (byCusip = {}, unresolved = {}) => {
  fs.writeFileSync(process.env.SECURITY_MASTER_FILE, JSON.stringify({ byCusip, unresolved }));
  master.resetSecurityMaster();
};
const seedFromFlat = () => {
  fs.rmSync(process.env.SECURITY_MASTER_FILE, { force: true });
  master.resetSecurityMaster();
};
const entry = (ticker) => ({ ticker, name: null, exchange: null, figi: null, validFrom: null, validTo: null, source: 'static', resolvedAt: null });
const daysAgo = (n) => new Date(Date.now() - n * 86400 * 1000).toISOString();

test('ISIN check digits: a US CUSIP and a Bermuda CINS produce the published ISINs', () => {
  assert.equal(figi.cusipToIsin('037833100', 'US'), 'US0378331005', 'Apple');
  assert.equal(figi.cusipToIsin('594918104', 'US'), 'US5949181045', 'Microsoft');
  assert.equal(figi.cusipToIsin('G5876H105', 'BM'), 'BMG5876H1051', 'Marvell (CINS under Bermuda)');
  assert.equal(figi.cusipToIsin('bad', 'US'), null);
  assert.deepEqual(figi.isinCandidates('037833100'), ['US0378331005']);
  const chubb = figi.isinCandidates('H1467J104');
  assert.deepEqual(chubb, ['CHH1467J1041'], 'H → Switzerland');
  assert.ok(figi.isinCandidates('G5876H105').includes('BMG5876H1051'), 'G → Bermuda among the candidates');
  assert.equal(figi.figiIdType('H1467J104'), 'ID_CINS');
});

test('the master seeds itself from the flat map, records answers and failures, and retries after a day', () => {
  seedFromFlat();
  assert.equal(master.tickerFor('037833100'), 'AAPL', 'seeded from api/_data/cusip-tickers.json');
  assert.equal(master.tickerFor('H1467J104'), 'CB');
  assert.equal(master.tickerFor('ZZZZZZZZ9'), null);
  assert.equal(master.labelFor('ZZZZZZZZ9', 'ZED CORP'), 'ZED CORP', 'unresolved: the issuer name, never the code');
  assert.deepEqual(master.needsLookup(['037833100', 'ZZZZZZZZ9', 'zzzzzzzz9']), ['ZZZZZZZZ9'], 'known ones skipped, case-folded, de-duplicated');
  master.record('ZZZZZZZZ9', null, { name: 'ZED CORP' });
  assert.deepEqual(master.needsLookup(['ZZZZZZZZ9']), [], 'just tried: not asked again today');
  assert.deepEqual(master.needsLookup(['ZZZZZZZZ9'], { now: Date.now() + 25 * 3600 * 1000 }), ['ZZZZZZZZ9'], 'due again after a day');
  assert.deepEqual(master.retryQueue({ now: Date.now() + 25 * 3600 * 1000 }), ['ZZZZZZZZ9']);
  assert.equal(master.labelFor('ZZZZZZZZ9'), 'ZED CORP', 'the name the filing carried is remembered');
  master.record('ZZZZZZZZ9', { ticker: 'zed', name: 'Zed Corp', exchange: 'US', figi: 'BBG000000000' }, { source: 'openfigi' });
  assert.equal(master.tickerFor('ZZZZZZZZ9'), 'ZED');
  assert.equal(master.securityEntry('ZZZZZZZZ9').source, 'openfigi');
  assert.equal(master.stats().unresolved, 0);
  assert.equal(master.persist(), true);
  const saved = JSON.parse(fs.readFileSync(process.env.SECURITY_MASTER_FILE, 'utf8'));
  assert.equal(saved.byCusip.ZZZZZZZZ9.ticker, 'ZED');
  assert.ok(saved.updatedAt);
  master.resetSecurityMaster();
  assert.equal(master.tickerFor('ZZZZZZZZ9'), 'ZED', 'read back from the file');
});

test('resolution chain: ID_CINS, then ID_CUSIP, then the derived ISIN; a failed request records no attempt', async () => {
  const calls = [];
  // a fake OpenFIGI: answers only the Swiss ISIN for Chubb's CINS, and
  // nothing for a made-up US CUSIP; one batch fails outright
  const http = {
    post: async (url, jobs) => {
      calls.push(jobs.map((j) => `${j.idType}:${j.idValue}`));
      if (jobs.some((j) => String(j.idValue).includes('999999999'))) return { status: 503, data: null };
      return {
        status: 200,
        data: jobs.map((j) => (j.idType === 'ID_ISIN' && j.idValue === 'CHH1467J1041' ? { data: [{ ticker: 'CB', name: 'Chubb Ltd', exchCode: 'US', figi: 'BBG000BR14K5' }] } : { error: 'No identifier found.' })),
      };
    },
  };
  // Chubb unknown and tried two days ago (due), a made-up CUSIP never tried
  seed({}, { H1467J104: { attempts: 1, lastTried: daysAgo(2) } });
  const r = await figi.resolveIntoMaster(['H1467J104', '888888888'], { key: 'k', http, names: { 888888888: 'ZED CORP' }, maxLive: 10 });
  assert.equal(r.looked, 2);
  assert.equal(r.resolved, 1);
  assert.equal(master.tickerFor('H1467J104'), 'CB');
  assert.equal(master.securityEntry('H1467J104').source, 'isin');
  const order = calls.map((c) => c[0].split(':')[0]);
  assert.deepEqual(order, ['ID_CINS', 'ID_CUSIP', 'ID_CUSIP', 'ID_ISIN'], 'CINS first, then CUSIP for the plain and again for the CINS, then ISIN');
  assert.equal(master.securityEntry('888888888'), null);
  assert.equal(master.labelFor('888888888'), 'ZED CORP', 'the unresolved entry remembers the issuer');
  assert.equal(master.stats().unresolved, 1);
  assert.deepEqual(master.needsLookup(['888888888']), [], 'tried today: not asked again until tomorrow');
  // an identifier tried an hour ago is not asked again
  seed({}, { H1467J104: { attempts: 1, lastTried: daysAgo(0.04) } });
  calls.length = 0;
  const r2 = await figi.resolveIntoMaster(['H1467J104'], { key: 'k', http, maxLive: 10 });
  assert.deepEqual([r2.looked, calls.length], [0, 0]);
  // a batch whose request failed leaves its identifiers unasked
  seed();
  await figi.resolveIntoMaster(['999999999'], { key: 'k', http, maxLive: 10 });
  assert.equal(master.stats().unresolved, 0, 'no attempt recorded for a failed request');
});

test('mapCusipsToTickers keeps its shape and answers from the master without a network', async () => {
  seedFromFlat();
  const out = await figi.mapCusipsToTickers(['037833100', 'H1467J104', 'ZZZZZZZZ7'], { maxLive: 0 });
  assert.deepEqual(out, { '037833100': 'AAPL', H1467J104: 'CB', ZZZZZZZZ7: null });
});

test('the history endpoint resolves stored raw CUSIPs at read time and falls back to the issuer name', () => {
  seed({ '037833100': entry('AAPL'), H1467J104: entry('CB') });
  const g = {
    name: 'Berkshire',
    quarters: [{ reportDate: '2026-06-30', top10: ['AAPL', 'H1467J104', 'ZZZZZZZZ6'] }],
    positions: {
      '037833100': { ticker: 'AAPL', issuer: 'APPLE INC', heldQuarters: 35 },
      H1467J104: { ticker: null, issuer: 'CHUBB LIMITED', heldQuarters: 11 },
      ZZZZZZZZ6: { ticker: null, issuer: 'ZED CORP', heldQuarters: 2 },
    },
  };
  const { quarters, unresolved } = resolveQuarters(g);
  assert.deepEqual(quarters[0].top10, ['AAPL', 'CB', 'ZED CORP'], 'CB from the master, the issuer for the unknown');
  assert.equal(unresolved, 1);
  const th = resolveTimeHeld(g);
  assert.equal(th.H1467J104.ticker, 'CB');
  assert.equal(th.ZZZZZZZZ6.ticker, null);
  assert.equal(findPositionByTicker(g, 'CB')[0], 'H1467J104', 'a pair page finds the position by the resolved ticker');
  // a shared-name list (related managers) carries no issuer; the master's own
  // memory of a failed lookup supplies the name, a never-seen code stays as is
  assert.deepEqual(resolveSymbols(['AAPL', 'H1467J104', 'ZZZZZZZZ6']), ['AAPL', 'CB', 'ZZZZZZZZ6']);
  master.record('ZZZZZZZZ6', null, { name: 'ZED CORP' });
  assert.deepEqual(resolveSymbols(['ZZZZZZZZ6']), ['ZED CORP']);
});

test('turnover keyed by the master id: a CUSIP change under a holding is not a trade', () => {
  seed();
  const prev = { aum: 1000, positions: [{ cusip: 'OLD000001', shares: 10, value: 1000 }] };
  const cur = { aum: 1000, positions: [{ cusip: 'NEW000001', shares: 10, value: 1000 }] };
  assert.equal(turnover(prev, cur).turnover, 200, 'by CUSIP: an exit and a new position, the whole book twice');
  const idOf = (p) => ({ OLD000001: 'ACME', NEW000001: 'ACME' })[p.cusip] || p.cusip;
  const t = turnover(prev, cur, { idOf });
  assert.equal(t.turnover, 0);
  assert.deepEqual([t.newCount, t.exitCount], [0, 0]);
});

test('UI labels: the issuer, shortened, replaces a raw CUSIP', () => {
  assert.deepEqual(securityLabel({ ticker: 'CB', cusip: 'H1467J104' }), { text: 'CB', isTicker: true, title: 'H1467J104' });
  const l = securityLabel({ ticker: null, issuer: 'CHUBB LIMITED', cusip: 'H1467J104' });
  assert.equal(l.isTicker, false);
  assert.equal(l.text, 'Chubb Limited');
  assert.equal(l.title, 'CHUBB LIMITED · H1467J104');
  assert.equal(shortIssuer('ALPHABET INC CL C'), 'Alphabet');
  assert.equal(shortIssuer('BERKSHIRE HATHAWAY INC DEL CL B'), 'Berkshire Hat…');
  assert.equal(securityLabel({ cusip: 'X1' }).text, 'X1', 'only when nothing else is known');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
