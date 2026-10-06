import { useI18n } from '../i18n.jsx';
import { fmtPct, deltaClass, quarterLabel } from '../lib/format.js';

// 1 / 3 / 5 / 10-year chained 13F portfolio return against SPY
// (api/_lib/performance.js) — the guru page's "Geçmiş" tab and, in
// `compact` form, a card on the gurus index.
const KEYS = ['y1', 'y3', 'y5', 'y10'];

export default function PerformanceCard({ data, compact = false }) {
  const { t } = useI18n();
  const h = data?.horizons;
  if (!h || KEYS.every((k) => h[k]?.port == null)) return null;
  return (
    <div className="card" data-performance>
      <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>{t('perf.title')}</h2>
      {!compact && h.y1?.port != null && (
        <p className="muted small">
          {t(h.y1.diff >= 0 ? 'perf.lead.beat' : 'perf.lead.trail')
            .replace('{port}', fmtPct(h.y1.port))
            .replace('{spy}', fmtPct(h.y1.spy))
            .replace('{diff}', fmtPct(Math.abs(h.y1.diff)).replace('+', ''))}
        </p>
      )}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="l">{t('perf.window')}</th>
              <th>{t('perf.portfolio')}</th>
              <th>SPY</th>
              <th>{t('perf.diff')}</th>
              {!compact && <th>{t('perf.coverage')}</th>}
            </tr>
          </thead>
          <tbody>
            {KEYS.map((k) => {
              const r = h[k] || {};
              return (
                <tr key={k}>
                  <td className="l">
                    <b>{t(`perf.${k}`)}</b>
                    {!compact && r.from && <span className="muted small" style={{ marginLeft: 6 }}>{quarterLabel(r.from)} →</span>}
                  </td>
                  <td className={`num ${deltaClass(r.port)}`}>{fmtPct(r.port)}</td>
                  <td className={`num ${deltaClass(r.spy)}`}>{fmtPct(r.spy)}</td>
                  <td className={`num ${deltaClass(r.diff)}`}>{r.diff != null ? fmtPct(r.diff) : '—'}</td>
                  {!compact && <td className="num muted">{r.coverage != null ? `${Math.round(r.coverage * 100)}%` : '—'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!compact && (
        <p className="muted small mt8">
          {t('perf.note')}
          {data.asOf ? ` ${t('perf.asOf')}: ${data.asOf}.` : ''}
          {data.current === false ? ` ${t('perf.closed')}` : ''}
        </p>
      )}
    </div>
  );
}
