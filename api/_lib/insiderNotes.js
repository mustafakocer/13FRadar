// What a Form 4 line's footnotes and remarks say about HOW the shares were
// acquired — read by the cluster rules (insiderCluster.js) and by the
// served rows (insiderStore.readServed: compensation shares).

// footnotes and the filing's remarks
export const notesOf = (raw) => [raw?.fn ? Object.values(raw.fn).join(' ') : '', raw?.rm || ''].join(' ').trim();

// Sentences about the HOLDING ("Includes shares acquired through the
// dividend reinvestment plan") say nothing about how this purchase was made;
// they are left out, with the sentence that carries one on ("Includes shares
// acquired pursuant to the ESPP. Such acquisitions are exempt under Rule
// 16b-3." — Matador).
const HOLDING_NOTE_RE = /^(this (amount|total|number) )?(also )?includes\b|^(the )?(amount|number|total) of (securities|shares) (beneficially )?owned[^.]*includes\b/i;
// Sentences, not broken after "Inc." or "L.P." ("…accrued under the 2020
// Match Group, Inc. Deferred Compensation Plan…" is one sentence)
const ABBREV_RE = /\b(inc|corp|co|ltd|llc|jr|sr|no|mr|mrs|ms|dr|st|l\.p|u\.s|n\.a|s\.a|n\.v|plc)\.$/i;
export function sentencesOf(text) {
  const out = [];
  for (const part of String(text || '').split(/(?<=\.)\s+(?=[A-Z(])/)) {
    if (out.length && ABBREV_RE.test(out[out.length - 1])) out[out.length - 1] += ` ${part}`;
    else out.push(part);
  }
  return out;
}
export function aboutTheTrade(text) {
  if (!text) return '';
  const parts = sentencesOf(text);
  return parts
    .filter((x, i) => !HOLDING_NOTE_RE.test(x.trim()) && !(i > 0 && HOLDING_NOTE_RE.test(parts[i - 1].trim()) && /^such\b/i.test(x.trim())))
    .join(' ')
    .trim();
}

// the sentence of `t` that `re` matches in
export function sentence(t, re) {
  const m = re.exec(t);
  if (!m) return null;
  const start = Math.max(0, t.lastIndexOf('.', m.index) + 1);
  const end = t.indexOf('.', m.index + m[0].length);
  return t.slice(start, end < 0 ? undefined : end + 1).trim().slice(0, 240);
}

// Shares paid as pay, filed with code P: board fees ("shares issued under
// The Eastern Company Director's Fee Program pursuant to rule 16b-3(d)"),
// stock "in lieu of the quarterly cash retainer" (FIS), director or bonus
// compensation (QNB, Workhorse), an issuer transaction exempt under Rule
// 16b-3. A fee alone is not pay: "dealer manager fee of 3%" is what an
// offering cost (Bluerock) — hence the narrow fee phrases.
export const COMPENSATION_RE =
  /\bin lieu of\b|\bdirector'?s?'? fees?\b|\bboard fees?\b|\bfee program\b|\bfees? (paid|payable|earned|owed) to\b|\bretainers?\b|\bcompensation\b(?! committee)|\b16b-3\b/i;

// → the sentence that says so, or null
export function compensationOf(raw) {
  const t = aboutTheTrade(notesOf(raw));
  return t && COMPENSATION_RE.test(t) ? sentence(t, COMPENSATION_RE) : null;
}

// Served rows: a P line whose notes say the shares were pay carries `cp`
// (the sentence). insiderClassify.categorize makes it 'compensation' — not
// an open-market buy anywhere (totals, rankings, clusters, signals).
export function markCompensation(rows, rawOf) {
  if (!rawOf) return rows;
  return rows.map((r) => {
    if (r.k !== 'P') return r;
    const q = compensationOf(rawOf(r));
    return q ? { ...r, cp: q } : r;
  });
}
