import { useI18n } from '../i18n.jsx';
import { dataFreshness } from '../lib/secCalendar.js';

// "Her gün güncellenir · son güncelleme: 2 Ekim 2026 09:22 UTC" — what the
// data is, never "Canlı veri" / "Gerçek zamanlı": the site is rebuilt from
// EDGAR every day. `updatedAt` is when the data was built; `dataDay` the
// newest filing day in it (insiders) and `quarter` the period it reports
// (13F). When the newest filing is more than one business day old the line
// says so instead (secCalendar.dataFreshness, the rule the alarm uses).
export function stamp(iso, locale) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const date = d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${date} ${time} UTC`;
}

const day = (iso, locale) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : null);

export default function UpdatedLine({ updatedAt, dataDay = null, quarter = null, quarterText = null }) {
  const { t, lang } = useI18n();
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const stale = dataDay && !dataFreshness(dataDay).live;
  const parts = [t('data.daily')];
  const when = stamp(updatedAt, locale);
  if (when) parts.push(`${t('data.lastUpdate')}: ${when}`);
  if (dataDay) parts.push(`${t('data.lastFiling')}: ${day(dataDay, locale)}`);
  if (quarter) parts.push(`${t('data.quarter')}: ${quarterText || quarter}`);
  return (
    <span className={`live-pill${stale ? ' stale' : ''}`} data-updated-at={updatedAt || ''}>
      {parts.join(' · ')}
    </span>
  );
}
