// A company whose newest annual report is a 10-K is not a foreign private
// issuer, whatever 20-Fs sit further back in its history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { annualStatus } from '../api/_lib/annualForm.js';

test('annualStatus: the newest annual report decides', () => {
  // Indivior: 20-F until 2024, 10-K since
  assert.equal(annualStatus([{ form: '20-F', date: '2024-03-15' }, { form: '10-K', date: '2026-02-26' }, { form: '6-K', date: '2025-06-01' }]).status, 'domestic');
  assert.equal(annualStatus([{ form: '10-K', date: '2019-03-01' }, { form: '20-F', date: '2026-04-20' }]).status, 'foreign');
  assert.equal(annualStatus([{ form: '40-F', date: '2026-03-20' }]).status, 'foreign');
  assert.equal(annualStatus([{ form: '10-KT', date: '2025-12-01' }]).status, 'domestic');
  // an amendment is not the annual report itself
  assert.equal(annualStatus([{ form: '20-F', date: '2025-04-01' }, { form: '10-K/A', date: '2026-01-10' }]).status, 'foreign');
  assert.equal(annualStatus([{ form: '6-K', date: '2026-01-10' }]).status, 'unclear');
});
