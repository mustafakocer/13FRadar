// The numbers the site states about itself come from the data, not from the
// source: the 13F universe's size (universe-summary.json), the tracked and the
// counted superinvestors (consensus `coverage`). And the quarterly report a
// fund page links to is the current quarter's, or the live quarter page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { root, ssr } from './helpers.mjs';
import { fundCountLabel, fundCountRounded } from '../client/src/lib/fundCount.js';
import { homeSeo, consensusSeo } from '../client/src/lib/seoTemplates.js';
import { reportLink, reportDue, reportIdForQuarter, REPORT_GRACE_DAYS } from '../client/src/lib/reportLink.js';

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));
const meta = (html) => html.match(/<meta name="description" content="([^"]*)"/)?.[1] || '';
const title = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1] || '';

test('fundCountLabel rounds down in a step that fits the size of the number', () => {
  assert.equal(fundCountLabel(9046, { round: true }), '9,000+');
  assert.equal(fundCountLabel(9046, { round: true, locale: 'tr-TR' }), '9.000+');
  assert.equal(fundCountLabel(9999, { round: true }), '9,000+');
  assert.equal(fundCountLabel(10000, { round: true }), '10,000+');
  assert.equal(fundCountLabel(840, { round: true }), '800+');
  assert.equal(fundCountLabel(98, { round: true }), '90+', 'a count under 100 must not read "0+"');
  assert.equal(fundCountLabel(100, { round: true }), '100+');
  assert.equal(fundCountLabel(7, { round: true }), '7', 'under one step: the number itself');
  assert.equal(fundCountLabel(9046), '9,046');
  for (const bad of [0, -3, NaN, null, undefined, '9046']) assert.equal(fundCountLabel(bad, { round: true }), null);
  assert.equal(fundCountRounded(9046, 'tr'), '9.000+');
  assert.equal(fundCountRounded(null, 'tr'), null);
});

test('no page source carries a typed fund or superinvestor count', () => {
  const dir = path.join(root, 'client', 'src');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
    }
  };
  walk(dir);
  files.push(path.join(root, 'scripts', 'build-llms.mjs'), path.join(root, 'api', '_handlers', 'og.js'));
  // "8.000+ fon", "~8,000 funds", "8.000'den fazla fonun", "60+ usta", "60+ superinvestors"
  const stale = [
    /[~≈]?\b\d{1,2}[.,]000\+?\s*(?:13F\s+)?(?:fon|funds?|filers?|kurum|institutions?)/i,
    /\b\d{1,2}[.,]000['’]den fazla/i,
    /\b\d{2,3}\+\s*(?:usta|superinvestors?|gurus?)/i,
  ];
  const hits = [];
  for (const f of files) {
    const rel = path.relative(root, f);
    read(rel)
      .split('\n')
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // comments may quote the old numbers
        if (stale.some((re) => re.test(line))) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
      });
  }
  assert.deepEqual(hits, []);
});

test('the home description states the exact count, the universe one the rounded count, or no number at all', () => {
  assert.match(homeSeo({ lang: 'tr', fundCount: 9046 }).description, /^9\.046 fonun 13F portföyleri/);
  assert.match(homeSeo({ lang: 'en', fundCount: 9046 }).description, /^13F portfolios of 9,046 funds,/);
  assert.match(homeSeo({ lang: 'tr' }).description, /^Binlerce fonun 13F/);
  assert.match(homeSeo({ lang: 'en' }).description, /^13F portfolios of thousands of funds,/);
  const data = { coverage: { tracked: 98, filed: 91, included: 70 }, managers: new Array(72).fill({ reportDate: '2026-09-30' }) };
  const uni = consensusSeo({ lang: 'en', data, segment: 'universe', fundCount: 9046 });
  assert.match(uni.description, /every 13F filer \(9,000\+ funds\)/);
  assert.doesNotMatch(consensusSeo({ lang: 'tr', data, segment: 'universe' }).description, /\(|000/);
});

test('the consensus copy names the 70 as counted, never as the number tracked', () => {
  const top = { ticker: 'META', issuer: 'META', holderCount: 36, buyers: 22, sellers: 3 };
  const data = {
    coverage: { tracked: 98, filed: 91, included: 70 },
    managers: new Array(72).fill({ reportDate: '2026-09-30' }),
    mostHeld: [top],
    topBought: [top],
    topSold: [top],
    newPositions: [top],
  };
  for (const segment of ['held', 'bought', 'sold', 'new', 'funds']) {
    const en = consensusSeo({ lang: 'en', data, segment });
    const tr = consensusSeo({ lang: 'tr', data, segment });
    for (const s of [en.description, en.answer, tr.description, tr.answer].filter(Boolean)) {
      assert.doesNotMatch(s, /\b72\b/, `${segment}: managers.length leaked: ${s}`);
      assert.doesNotMatch(s, /70[^.]{0,40}\btracked\b|takip edilen[^.]{0,20}\b70\b/, `${segment}: 70 called "tracked": ${s}`);
      assert.doesNotMatch(s, /the the |fonlarun/, s);
    }
    assert.match(en.description, /70 funds counted in the consensus/);
    assert.match(tr.description, /konsensüse dahil 70 fon/);
  }
  // no coverage on file: grammatical, and no number
  const bare = consensusSeo({ lang: 'tr', data: {}, segment: 'held' });
  assert.match(bare.description, /^takip edilen fonların birleşik 13F görünümü\./);
  assert.match(consensusSeo({ lang: 'en', data: {}, segment: 'held' }).description, /^Combined 13F view of the tracked funds\./);
});

test('SSR: /screen and /match carry the counts from the data in title and description', async () => {
  const count = json('client/public/universe-summary.json').count;
  const tracked = json('client/public/consensus.json').coverage.tracked;
  const scrTr = await ssr('/tr/screen');
  assert.ok(title(scrTr.html).includes(`${fundCountRounded(count, 'tr')} 13F Dosyalayan`), title(scrTr.html));
  const scrEn = await ssr('/en/screen');
  assert.ok(title(scrEn.html).includes(`Filter ${fundCountRounded(count, 'en')} 13F Filers`), title(scrEn.html));
  const mTr = await ssr('/tr/match');
  assert.ok(meta(mTr.html).includes(`takip edilen ${fundCountRounded(tracked, 'tr')} usta yatırımcının`), meta(mTr.html));
  const mEn = await ssr('/en/match');
  assert.ok(meta(mEn.html).includes(`the ${fundCountRounded(tracked, 'en')} superinvestors we track`), meta(mEn.html));
  const home = await ssr('/tr');
  assert.ok(meta(home.html).startsWith(`${fundCountLabel(count, { locale: 'tr-TR' })} fonun`), meta(home.html));
  // the post-deploy site check refuses a rounded count anywhere on the home page
  assert.ok(!/\d\.000\+/.test(home.html), 'a rounded fund count on the home page');
  const uni = await ssr('/en/consensus/universe');
  assert.ok(meta(uni.html).includes(`(${fundCountRounded(count, 'en')} funds)`), meta(uni.html));
});

test('reportIdForQuarter reads quarter ends only', () => {
  assert.equal(reportIdForQuarter('2026-09-30'), '2026-q3');
  assert.equal(reportIdForQuarter('2026-12-31'), '2026-q4');
  assert.equal(reportIdForQuarter('2027-03-31'), '2027-q1');
  for (const bad of ['2026-08-31', '', null, undefined, '2026-q3', 'x']) assert.equal(reportIdForQuarter(bad), null);
});

test('reportLink: the archived report only while it is the current quarter’s', () => {
  // the case on the live site: consensus on Q3, archive still at Q2
  assert.deepEqual(reportLink({ latest: '2026-q2', quarterEnd: '2026-09-30' }), { to: '/report', id: null });
  assert.deepEqual(reportLink({ latest: '2026-q3', quarterEnd: '2026-09-30' }), { to: '/reports/2026-q3', id: '2026-q3' });
  assert.deepEqual(reportLink({ latest: '2026-Q3', quarterEnd: '2026-09-30' }), { to: '/reports/2026-q3', id: '2026-q3' });
  // year boundary, both ways
  assert.deepEqual(reportLink({ latest: '2026-q4', quarterEnd: '2027-03-31' }), { to: '/report', id: null });
  assert.deepEqual(reportLink({ latest: '2027-q1', quarterEnd: '2026-12-31' }), { to: '/reports/2027-q1', id: '2027-q1' });
  // quarter unknown: the newest archive is the best there is
  assert.deepEqual(reportLink({ latest: '2026-q2', quarterEnd: null }), { to: '/reports/2026-q2', id: '2026-q2' });
  // no archive at all
  assert.deepEqual(reportLink({ latest: null, quarterEnd: '2026-09-30' }), { to: '/report', id: null });
  assert.equal(reportLink({ latest: null, quarterEnd: null }), null);
  assert.equal(reportLink(), null);
  assert.deepEqual(reportLink({ latest: 'garbage', quarterEnd: '2026-09-30' }), { to: '/report', id: null });
});

test('reportDue: once per quarter, after the deadline, with most of the panel in', () => {
  const coverage = { quarter: '2026-09-30', tracked: 98, filed: 91, included: 70 };
  // 45 days after 30 Sep is 14 Nov; the grace period follows
  const first = new Date(Date.parse('2026-09-30T00:00:00Z') + (45 + REPORT_GRACE_DAYS) * 86400000).toISOString().slice(0, 10);
  const dayBefore = new Date(Date.parse(`${first}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  assert.deepEqual(reportDue({ coverage, existing: ['2026-q2'], today: first }), { due: true, id: '2026-q3', year: 2026, quarter: 3 });
  assert.deepEqual(reportDue({ coverage, existing: ['2026-q2'], today: dayBefore }), { due: false, reason: 'before-deadline' });
  assert.deepEqual(reportDue({ coverage, existing: ['2026-q3', '2026-q2'], today: '2026-12-01' }), { due: false, reason: 'exists' });
  assert.deepEqual(reportDue({ coverage, existing: ['2026-Q3'], today: '2026-12-01' }), { due: false, reason: 'exists' });
  // filing season: the quarter has rolled over but few have filed
  assert.deepEqual(reportDue({ coverage: { ...coverage, filed: 40 }, existing: [], today: '2026-12-01' }), { due: false, reason: 'coverage' });
  assert.deepEqual(reportDue({ coverage: { ...coverage, included: 0 }, existing: [], today: '2026-12-01' }), { due: false, reason: 'coverage' });
  assert.deepEqual(reportDue({ coverage: { ...coverage, tracked: 0 }, existing: [], today: '2026-12-01' }), { due: false, reason: 'coverage' });
  assert.deepEqual(reportDue({ coverage: { quarter: '2026-12-31', tracked: 98, filed: 95, included: 72 }, existing: ['2026-q3'], today: '2027-02-19' }), { due: true, id: '2026-q4', year: 2026, quarter: 4 });
  assert.deepEqual(reportDue({ coverage: null, existing: [], today: '2026-12-01' }), { due: false, reason: 'no-quarter' });
  assert.deepEqual(reportDue({ coverage, existing: [], today: 'soon' }), { due: false, reason: 'no-date' });
  assert.deepEqual(reportDue(), { due: false, reason: 'no-quarter' });
});

test('the report archive: index newest first, every id has its files, the sitemap lists them', async () => {
  const ids = json('api/_data/reports/index.json').reports;
  assert.deepEqual(ids, [...ids].sort().reverse());
  for (const id of ids) {
    const r = json(`api/_data/reports/${id}.json`);
    assert.equal(r.id, id);
    assert.equal(reportIdForQuarter(r.quarterEnd), id);
    assert.ok(r.managers.length > 0 && r.topBuysByValue.length > 0 && r.topSellsByValue.length > 0, id);
    assert.ok(r.answer?.en && r.answer?.tr, id);
    assert.ok(fs.existsSync(path.join(root, 'reports', `${id}.md`)), `${id}.md`);
    const page = await ssr(`/en/reports/${id}`);
    assert.equal(page.status, 200, id);
  }
  const { default: sitemap } = await import('../api/_handlers/sitemap.js');
  const xml = await new Promise((resolve) => {
    const res = { setHeader() {}, status() { return this; }, send: resolve, end: resolve };
    sitemap({ query: { type: 'pages' }, headers: { host: 'example.test' } }, res);
  });
  for (const id of ids) assert.match(String(xml), new RegExp(`/reports/${id}<`), `sitemap lacks ${id}`);
});

test('the nightly job builds the report in the commit it already makes', () => {
  const yml = read('.github/workflows/consensus.yml');
  const step = yml.indexOf('node scripts/build-report-if-due.mjs');
  const audit = yml.indexOf('- name: Audit the rebuilt data');
  const commit = yml.indexOf('- name: Commit if changed');
  assert.ok(audit > 0 && step > audit && commit > step, 'the report step runs after the audit and before the commit');
  const staged = yml.slice(commit).match(/for f in ([^;]+); do/)?.[1] || '';
  assert.match(staged, /\bapi\/_data\/reports\b/);
  assert.match(staged, /(^|\s)reports(\s|$)/);
});
