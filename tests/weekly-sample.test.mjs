import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const fixtures = new URL('./fixtures/sec/filings/', import.meta.url).pathname;
const tables = () => {
  const out = [];
  for (const cik of fs.readdirSync(fixtures)) for (const acc of fs.readdirSync(path.join(fixtures, cik))) {
    const f = path.join(fixtures, cik, acc, 'infotable.xml');
    if (fs.existsSync(f)) out.push(f);
  }
  return out;
};

test('isoWeek: ISO 8601 weeks, year boundaries included', async () => {
  const { isoWeek } = await import('../api/_lib/sampleCheck.js');
  assert.equal(isoWeek(new Date('2026-10-14T09:00:00Z')), '2026-W42');
  assert.equal(isoWeek(new Date('2026-01-01T00:00:00Z')), '2026-W01');
  assert.equal(isoWeek(new Date('2027-01-01T00:00:00Z')), '2026-W53');
  assert.equal(isoWeek(new Date('2024-12-30T00:00:00Z')), '2025-W01');
});

test('rawLines: the own parser agrees with the site build on every fixture table', async () => {
  const { rawLines } = await import('../api/_lib/sampleCheck.js');
  const { parse13F, aggregatePositions } = await import('../api/_lib/sec.js');
  const files = tables();
  assert.ok(files.length >= 5);
  for (const f of files) {
    const xml = fs.readFileSync(f, 'utf8');
    const raw = rawLines(xml);
    const agg = aggregatePositions(await parse13F(xml), '2026-08-14');
    assert.equal(raw.size, agg.positions.length, f);
    for (const p of agg.positions) assert.equal(raw.get(`${p.cusip}|${p.putCall}`)?.shares, p.shares, `${f} ${p.cusip}`);
  }
});

test('rawLines: namespaces, put/call, repeated CUSIPs summed, thousands separators', async () => {
  const { rawLines } = await import('../api/_lib/sampleCheck.js');
  const row = (cusip, sh, pc = '') => `<ns1:infoTable><ns1:nameOfIssuer>X</ns1:nameOfIssuer><ns1:cusip>${cusip}</ns1:cusip><ns1:value>1</ns1:value><ns1:shrsOrPrnAmt><ns1:sshPrnamt>${sh}</ns1:sshPrnamt><ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>${pc ? `<ns1:putCall>${pc}</ns1:putCall>` : ''}</ns1:infoTable>`;
  const r = rawLines(`<ns1:informationTable>${row('abc123456', 100)}${row('ABC123456', '1,000')}${row('ABC123456', 50, 'Put')}</ns1:informationTable>`);
  assert.equal(r.size, 2);
  assert.equal(r.get('ABC123456|').shares, 1100);
  assert.equal(r.get('ABC123456|').lines, 2);
  assert.equal(r.get('ABC123456|Put').shares, 50);
  assert.equal(rawLines('').size, 0);
  // tags carrying attributes (BNP Paribas 2026-Q2: <infoTable xmlns="…">)
  const attr = rawLines('<informationTable xmlns="x"><infoTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable"><cusip>ZZZ999999</cusip><shrsOrPrnAmt><sshPrnamt units="SH">7</sshPrnamt></shrsOrPrnAmt></infoTable></informationTable>');
  assert.equal(attr.size, 1);
  assert.equal(attr.get('ZZZ999999|').shares, 7);
});

test('pickSample: the same week the same ten, 4 gurus + 6 other filers, amended/misfiled/stale/tiny left out', async () => {
  const { pickSample } = await import('../api/_lib/sampleCheck.js');
  const q = '2026-06-30';
  const funds = Array.from({ length: 300 }, (_, i) => ({ cik: String(i).padStart(10, '0'), name: `F${i}`, aum: (300 - i) * 1e9, reportDate: q, slug: `f${i}`, kind: i % 3 === 0 ? 'guru' : 'filer' }));
  funds.push({ cik: 'A', aum: 1e15, reportDate: q, slug: 'a', amended: true }, { cik: 'M', aum: 1e15, reportDate: q, slug: 'm', misfiled: true }, { cik: 'S', aum: 1e15, reportDate: '2026-03-31', slug: 's' }, { cik: 'T', aum: 50e6, reportDate: q, slug: 't' }, { cik: 'N', aum: 1e15, reportDate: q });
  const a = pickSample(funds, { week: '2026-W42', quarter: q });
  const b = pickSample(funds, { week: '2026-W42', quarter: q });
  const c = pickSample(funds, { week: '2026-W43', quarter: q });
  assert.equal(a.length, 10);
  assert.deepEqual(a.map((f) => f.cik), b.map((f) => f.cik));
  assert.notDeepEqual(a.map((f) => f.cik), c.map((f) => f.cik));
  assert.equal(new Set(a.map((f) => f.cik)).size, 10);
  assert.equal(a.filter((f) => f.kind === 'guru').length, 4);
  for (const x of ['A', 'M', 'S', 'T', 'N']) assert.ok(!a.some((f) => f.cik === x), x);
  // too few other filers: filled from the gurus
  const few = pickSample(funds.filter((f) => f.kind === 'guru' || f.cik === '0000000001'), { week: '2026-W42', quarter: q });
  assert.equal(few.length, 10);
  assert.equal(few.filter((f) => f.kind === 'guru').length, 9);
});

test('compareSample and the issue: shares match within half a share, count checked, a box per fund', async () => {
  const { compareSample, sampleIssue, rawLines } = await import('../api/_lib/sampleCheck.js');
  const raw = new Map([['AAA|', { shares: 100.4 }], ['BBB|Call', { shares: 5 }]]);
  const ok = compareSample({ count: 2, top: [{ cusip: 'AAA', shares: 100, value: 2e9, issuer: 'Alpha' }, { cusip: 'BBB', putCall: 'Call', shares: 5, value: 1e6, issuer: 'Beta | Inc' }] }, raw);
  assert.equal(ok.ok, true);
  const bad = compareSample({ count: 3, top: [{ cusip: 'AAA', shares: 90, value: 1, issuer: 'Alpha' }, { cusip: 'ZZZ', shares: 1, value: 1, issuer: 'Gone' }] }, raw);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.lines.map((l) => l.ok), [false, false]);
  assert.equal(bad.lines[1].sec, null);
  assert.equal(bad.count.ok, false);
  assert.equal(compareSample({ count: 0, top: [] }, rawLines('')).ok, false); // nothing compared is not a pass
  const fund = (cik, kind) => ({ cik, name: `Fund ${cik}`, acc: '0001067983-26-000001', aum: 3e11, reportDate: '2026-06-30', slug: `s${cik}`, kind });
  const { title, body, failed } = sampleIssue({ week: '2026-W42', mention: '@x', results: [{ fund: fund('0001067983', 'guru'), check: ok }, { fund: fund('2', 'filer'), check: bad }, { fund: fund('3', 'filer'), error: 'HTTP 503' }] });
  assert.equal(title, 'Haftalık örnek kontrol — 2026-W42');
  assert.equal(failed, 2);
  assert.match(body, /^@x /);
  assert.match(body, /1 fon tam uyuştu, 2 fonda fark var/);
  assert.equal((body.match(/^- \[ \] /gm) || []).length, 3);
  assert.match(body, /https:\/\/www\.fundocap\.co\/guru\/s0001067983/);
  assert.match(body, /https:\/\/www\.fundocap\.co\/filer\/s2/);
  assert.match(body, /https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1067983\/000106798326000001\//);
  assert.match(body, /Beta \/ Inc \(Call\)/);
  assert.match(body, /HTTP 503/);
  assert.match(sampleIssue({ week: 'w', results: [{ fund: fund('1', 'guru'), check: ok }] }).body, /hepsi SEC ile tam uyuştu/);
});

test('weekly-sample workflow: weekly, outside the night window, no email in the user agent, dry run on a PR', () => {
  const wf = fs.readFileSync(new URL('../.github/workflows/weekly-sample.yml', import.meta.url), 'utf8');
  const cron = wf.match(/cron: '(\d+) (\d+) \* \* (\d)'/);
  assert.ok(cron);
  const minutes = Number(cron[2]) * 60 + Number(cron[1]);
  assert.ok(minutes < 60 || minutes > 210);
  assert.match(wf, /issues: write/);
  assert.doesNotMatch(wf, /@[a-z0-9-]+\.[a-z]+/i);
  assert.match(wf, /--dry-run/);
  const src = fs.readFileSync(new URL('../scripts/weekly-sample.mjs', import.meta.url), 'utf8');
  assert.match(src, /already open: not opened twice/);
  assert.match(wf, /--scan-limit=300/); // a pull request scans the 300 largest, the schedule all
  assert.match(src, /scan-limit/);
});

test('compareSample: a table with swapped value and share columns matches once swapped back (CalSTRS)', async () => {
  const { compareSample, rawLines } = await import('../api/_lib/sampleCheck.js');
  const row = (cusip, value, sh) => `<infoTable><cusip>${cusip}</cusip><value>${value}</value><shrsOrPrnAmt><sshPrnamt>${sh}</sshPrnamt></shrsOrPrnAmt></infoTable>`;
  // as filed: shares in the value column, dollars in the share column
  const raw = rawLines(`<informationTable>${row('NVDA', 35021490, 7007449934)}${row('AAPL', 22278223, 6446426607)}</informationTable>`);
  const ours = { count: 2, top: [{ cusip: 'NVDA', shares: 35021490 }, { cusip: 'AAPL', shares: 22278223 }] };
  const c = compareSample(ours, raw);
  assert.equal(c.ok, true);
  assert.equal(c.swapped, true);
  assert.equal(compareSample({ ...ours, top: [{ cusip: 'NVDA', shares: 35021490 }, { cusip: 'AAPL', shares: 5 }] }, raw).ok, false);
});

test('the weekly issue: the whole-universe scan under the sample, verdict in the first line, differing funds largest first, capped', async () => {
  const { sampleIssue, scanSection, compareSample, SCAN_LIST_MAX } = await import('../api/_lib/sampleCheck.js');
  const okCheck = compareSample({ count: 1, top: [{ cusip: 'A', shares: 1 }] }, new Map([['A|', { shares: 1 }]]));
  const bad = compareSample({ count: 2, top: [{ cusip: 'A', shares: 1 }] }, new Map([['A|', { shares: 1 }]]));
  const fund = (cik, aum) => ({ cik, name: `Fund ${cik}`, acc: '0000000001-26-000001', aum, reportDate: '2026-06-30', slug: 's', kind: 'filer' });
  const scan = { checked: 8000, unreadable: 3, skipped: 600, differs: [{ fund: fund('1', 1e8), check: bad }, { fund: fund('2', 5e9), check: bad }] };
  const { body, scanDiffers } = sampleIssue({ week: 'w', mention: '@x', results: [{ fund: fund('9', 1e9), check: okCheck }], scan });
  assert.equal(scanDiffers, 2);
  assert.match(body.split('\n')[0], /8000 fonun tamamı otomatik tarandı: \*\*2 fonda fark var\*\*/);
  assert.match(body, /## Tüm fon taraması/);
  assert.ok(body.indexOf('Fund 2') < body.indexOf('Fund 1'));
  assert.match(body, /okunamayan 3 bildirim/);
  const many = scanSection({ checked: 1000, differs: Array.from({ length: SCAN_LIST_MAX + 5 }, (_, i) => ({ fund: fund(String(i), i), check: bad })) });
  assert.equal(many.filter((l) => l.startsWith('| Fund')).length, SCAN_LIST_MAX);
  assert.match(many.join('\n'), /… ve 5 fon daha/);
  assert.match(scanSection({ checked: 10, differs: [] }).join('\n'), /hepsi SEC ile birebir tuttu/);
  assert.deepEqual(scanSection(null), []);
  // without a scan the issue is the sample alone
  assert.doesNotMatch(sampleIssue({ week: 'w', results: [{ fund: fund('9', 1), check: okCheck }] }).body, /Tüm fon taraması/);
});
