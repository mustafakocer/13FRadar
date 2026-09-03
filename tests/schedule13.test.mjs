import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule13Xml, holderTimeline } from '../api/_lib/schedule13.js';

const XML = `<?xml version="1.0"?>
<edgarSubmission>
  <headerData><filerInfo><filer><issuerName>Acme Corp</issuerName></filer></filerInfo></headerData>
  <formData>
    <coverPageHeader><dateOfEvent>2026-08-15</dateOfEvent></coverPageHeader>
    <reportingPersonInfo>
      <reportingPersonName>Activist Capital LP</reportingPersonName>
      <aggregateAmountOwned>12,500,000</aggregateAmountOwned>
      <percentOfClass>7.4</percentOfClass>
    </reportingPersonInfo>
    <reportingPersonInfo>
      <reportingPersonName>John Doe</reportingPersonName>
      <aggregateAmountOwned>1000</aggregateAmountOwned>
      <percentOfClass>0.1</percentOfClass>
    </reportingPersonInfo>
    <item4><purposeOfTransaction>The Reporting Persons intend to engage with the board.</purposeOfTransaction></item4>
  </formData>
</edgarSubmission>`;

test('parseSchedule13Xml: holders, top percent, event date, subject, activist/amendment flags', async () => {
  const f = await parseSchedule13Xml(XML, { acc: 'A', form: 'SCHEDULE 13D/A', filingDate: '2026-08-20', url: 'u' });
  assert.equal(f.parsed, true);
  assert.equal(f.activist, true);
  assert.equal(f.amendment, true);
  assert.equal(f.eventDate, '2026-08-15');
  assert.equal(f.subject, 'Acme Corp');
  assert.equal(f.holders.length, 2);
  assert.equal(f.holder, 'Activist Capital LP');
  assert.equal(f.percent, 7.4);
  assert.equal(f.shares, 12500000);
  assert.ok(f.holders[0].purpose == null || f.holders[0].purpose.includes('board') || f.holders[1].purpose?.includes('board'));
  const bad = await parseSchedule13Xml('<html>not xml</html', { acc: 'B', form: 'SC 13G', filingDate: '2020-01-01', url: 'u' });
  assert.equal(bad.parsed, false);
  assert.equal(bad.activist, false);
});

test('holderTimeline groups by holder and sorts by latest percent', () => {
  const mk = (acc, date, name, pct) => ({ acc, form: 'SCHEDULE 13G', filingDate: date, url: '', parsed: true, activist: false, amendment: false, eventDate: null, subject: null, holders: [{ name, percent: pct, shares: null }], percent: pct, shares: null, holder: name });
  const tl = holderTimeline([mk('3', '2026-08-01', 'Vanguard Group', 9.1), mk('2', '2026-02-01', 'VANGUARD GROUP', 8.5), mk('1', '2026-01-01', 'BlackRock', 6)]);
  assert.equal(tl.length, 2);
  assert.equal(tl[0].name, 'Vanguard Group');
  assert.deepEqual(tl[0].events.map((e) => e.percent), [8.5, 9.1]);
});
