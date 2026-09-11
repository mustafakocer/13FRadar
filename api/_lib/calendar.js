// 13F filing calendar: deadlines are 45 days after each quarter end, rolled
// forward to the next business day (weekends only — SEC holiday shifts are
// rare and noted on the page).
const QUARTER_ENDS = [
  [3, 31],
  [6, 30],
  [9, 30],
  [12, 31],
];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

export function deadlineFor(quarterEndIso) {
  let d = addDays(new Date(`${quarterEndIso}T00:00:00Z`), 45);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = addDays(d, 1);
  return iso(d);
}

// All four deadlines around `now` (previous, current and upcoming periods).
export function deadlines(now = new Date()) {
  const y = now.getUTCFullYear();
  const out = [];
  for (const year of [y - 1, y, y + 1]) {
    QUARTER_ENDS.forEach(([m, d], i) => {
      const qe = `${year}-${pad(m)}-${pad(d)}`;
      out.push({ quarter: `Q${i + 1} ${year}`, quarterEnd: qe, deadline: deadlineFor(qe) });
    });
  }
  return out.sort((a, b) => a.quarterEnd.localeCompare(b.quarterEnd));
}

// The period currently being filed: the latest quarter end that has passed.
export function currentPeriod(now = new Date()) {
  const today = iso(now);
  const all = deadlines(now);
  const passed = all.filter((d) => d.quarterEnd < today);
  return passed[passed.length - 1];
}

export function nextDeadline(now = new Date()) {
  const today = iso(now);
  return deadlines(now).find((d) => d.deadline >= today);
}

// Filing season: the first three weeks of Feb/May/Aug/Nov.
export function inFilingSeason(now = new Date()) {
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  return [2, 5, 8, 11].includes(m) && d <= 20;
}

export const todayIso = (now = new Date()) => iso(now);
