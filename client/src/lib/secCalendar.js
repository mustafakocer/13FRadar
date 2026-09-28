// The SEC's working calendar, and how far behind a dataset is on it.
//
// Shared by the EDGAR crawl (which days can have a daily index), the
// freshness alarm, and the pages that show "Canlı veri" / "Son veri: …" — so
// the badge a reader sees and the alarm that pages us agree on what "late"
// means. Dates are YYYY-MM-DD strings in UTC throughout; EDGAR names its
// daily-index files by the Eastern calendar date, which is the same string.

// Federal holidays the SEC is closed on, as observed (a holiday on a Saturday
// is observed the Friday before, on a Sunday the Monday after). Columbus Day
// and Veterans Day are here although the stock exchanges trade on them: EDGAR
// does not accept filings and publishes no daily index. Good Friday is the
// opposite (exchanges closed, SEC open) and is deliberately absent.
//
// Extend this list every December. A closure missing from it (an unscheduled
// day of mourning, say) is still handled by the crawl: a day EDGAR skipped is
// recognised once a later day's index appears — it just takes a day longer.
export const SEC_HOLIDAYS = new Set([
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King Jr. Day
  '2026-02-16', // Washington's Birthday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed; the 4th is a Saturday)
  '2026-09-07', // Labor Day
  '2026-10-12', // Columbus Day — exchanges open, SEC closed
  '2026-11-11', // Veterans Day — exchanges open, SEC closed
  '2026-11-26', // Thanksgiving Day
  '2026-12-25', // Christmas Day
  // 2027
  '2027-01-01', // New Year's Day
  '2027-01-18', // Martin Luther King Jr. Day
  '2027-02-15', // Washington's Birthday
  '2027-05-31', // Memorial Day
  '2027-06-18', // Juneteenth (observed; the 19th is a Saturday)
  '2027-07-05', // Independence Day (observed; the 4th is a Sunday)
  '2027-09-06', // Labor Day
  '2027-10-11', // Columbus Day — exchanges open, SEC closed
  '2027-11-11', // Veterans Day — exchanges open, SEC closed
  '2027-11-25', // Thanksgiving Day
  '2027-12-24', // Christmas Day (observed; the 25th is a Saturday)
  '2027-12-31', // New Year's Day 2028 (observed; Jan 1 is a Saturday)
]);

// The last year the list above covers. Past it, rule (b) of the crawl cannot
// recognise a holiday, so the crawl goes red until the list is extended
// (calendarCoverage below); from 1 October of the last year it warns.
export const HOLIDAYS_LAST_YEAR = Math.max(...[...SEC_HOLIDAYS].map((d) => Number(d.slice(0, 4))));

// { error, warning } for a run on `day` (YYYY-MM-DD); both null when fine.
export function calendarCoverage(day, lastYear = HOLIDAYS_LAST_YEAR) {
  const year = Number(String(day).slice(0, 4));
  if (year > lastYear)
    return {
      error: `SEC holiday calendar ends ${lastYear}-12-31 and today is ${day} — the holiday list in client/src/lib/secCalendar.js must be updated (tatil takvimi güncellenmeli)`,
      warning: null,
    };
  if (year === lastYear && String(day) >= `${lastYear}-10-01`)
    return { error: null, warning: `${lastYear + 1} SEC holiday list must be added to client/src/lib/secCalendar.js before ${lastYear + 1}-01-01 (${lastYear + 1} tatil listesi eklenmeli)` };
  return { error: null, warning: null };
}

const DAY_MS = 86400000;
const toMs = (day) => Date.parse(`${day}T00:00:00Z`);
export const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day, n) => isoDay(toMs(day) + n * DAY_MS);

export const isWeekend = (day) => {
  const dow = new Date(toMs(day)).getUTCDay();
  return dow === 0 || dow === 6;
};
export const isSecHoliday = (day) => SEC_HOLIDAYS.has(day);
export const isSecBusinessDay = (day) => !isWeekend(day) && !isSecHoliday(day);

// SEC business days strictly after `from` and strictly before `to`: the days
// whose filings should already be in a dataset that ends on `from`, checked on
// `to`. On Monday with data through Friday that is 0 — Monday's filings are
// still arriving. On Tuesday with data through Friday it is 1 (Monday).
export function businessDaysBehind(from, to) {
  if (!from || !to || !(from < to)) return 0;
  let n = 0;
  for (let d = addDays(from, 1); d < to; d = addDays(d, 1)) if (isSecBusinessDay(d)) n++;
  return n;
}

// The one freshness rule for every date shown to a reader. `lastDay` is the
// newest filing date actually present in the data — never a write time, never
// a crawl checkpoint (both kept moving while the insider feed sat on
// 2026-09-18 for nine days).
//
// Live while at most one business day's filings are missing: the night crawl
// runs at 03:30 UTC, so on a normal morning the data ends yesterday (behind 0)
// and a single late night still reads as live (behind 1). Two missed business
// days is an outage and the badge must say so.
export const MAX_BUSINESS_DAYS_BEHIND = 1;
export function dataFreshness(lastDay, now = Date.now()) {
  if (!lastDay || !/^\d{4}-\d{2}-\d{2}$/.test(String(lastDay))) return { lastDay: null, behind: null, live: false };
  const behind = businessDaysBehind(String(lastDay), isoDay(now));
  return { lastDay: String(lastDay), behind, live: behind <= MAX_BUSINESS_DAYS_BEHIND };
}
