import { useI18n } from '../i18n.jsx';
import { quarterLabel } from '../lib/format.js';

const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// Turkish possessive after a numeral, by how the number is read aloud:
// 82 → 82'si (iki), 71 → 71'i (bir), 16 → 16'sı (altı), 40 → 40'ı (kırk).
const UNIT = ['', "'i", "'si", "'ü", "'ü", "'i", "'sı", "'si", "'i", "'u"];
const TENS = ['', "'u", "'si", "'u", "'ı", "'si", "'ı", "'i", "'i", "'ı"];
export function trPossessive(n) {
  const x = Math.abs(Math.trunc(n));
  if (x === 0) return "'ı";
  if (x % 10) return UNIT[x % 10];
  if (x % 100) return TENS[(x % 100) / 10];
  if (x % 1000) return "'ü";
  return x % 1e6 ? "'i" : "'u";
}

// The counts of one coverage object, made to add up whatever build wrote
// it: not filed = tracked − filed, wide books = filed − counted. Files
// written before the reasons were made disjoint (api/_lib/gurus.js) still
// read right.
export function coverageCounts(c) {
  const tracked = c.tracked;
  const filed = Math.min(c.filed, tracked);
  const included = Math.min(c.included, filed);
  return { tracked, filed, included, notFiled: tracked - filed, wideBook: filed - included };
}

// The one sentence that reconciles the fund counts a reader meets across the
// site: how many superinvestors are tracked, how many of them have filed for
// the quarter, and how many of those the number on the page is computed
// over. Reads the `coverage` object the builds write (api/_lib/gurus.js
// coverage()); renders nothing when a file predates it.
export default function CoverageLine({ coverage, className = 'muted small' }) {
  const { t, lang } = useI18n();
  if (!coverage || !Number.isFinite(coverage.tracked)) return null;
  const q = coverage.quarter ? quarterLabel(coverage.quarter) : '';
  const c = coverageCounts(coverage);
  const s = (n) => (lang === 'tr' ? trPossessive(n) : '');
  const line = fill(t('coverage.line'), { tracked: c.tracked, filed: `${c.filed}${s(c.filed)}`, included: `${c.included}${s(c.included)}`, q });
  const parts = [];
  if (c.notFiled > 0) parts.push(fill(t('coverage.notFiled'), { n: `${c.notFiled}${s(c.notFiled)}` }));
  if (c.wideBook > 0) parts.push(fill(t('coverage.wideBook'), { n: `${c.wideBook}${s(c.wideBook)}` }));
  return (
    <p className={className} data-coverage={`${c.tracked}/${c.filed}/${c.included}/${c.notFiled}/${c.wideBook}`}>
      {line}
      {parts.length > 0 && <> — {parts.join(' · ')}</>}
    </p>
  );
}
