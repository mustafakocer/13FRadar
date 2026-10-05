import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fmtPct, deltaClass } from '../lib/format.js';
import { useI18n } from '../i18n.jsx';

// The period-return strip under the stock page's price: 1G · 1H · 1A · 6A ·
// YBB · 1Y · 5Y, each green or red, from the nightly price archive
// (/api/perf). A period the archive cannot cover prints "—". On a phone the
// strip scrolls sideways (app.css .perf-strip).
const PERIODS = ['d1', 'w1', 'm1', 'm6', 'ytd', 'y1', 'y5'];

export default function PerfStrip({ ticker }) {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ['perf', ticker],
    queryFn: () => api.perf(ticker),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const periods = q.data?.periods;
  if (!periods) return null;
  return (
    <div className="perf-strip" title={t('perf.tip')}>
      {PERIODS.map((k) => {
        const v = periods[k];
        return (
          <span className="perf-cell" key={k}>
            <span className="perf-label">{t(`perf.${k}`)}</span>
            <b className={deltaClass(v)}>{v == null ? '—' : fmtPct(v)}</b>
          </span>
        );
      })}
    </div>
  );
}
