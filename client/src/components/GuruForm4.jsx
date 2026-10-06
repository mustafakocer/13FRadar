import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { fmtMoney, fmtNum, fmtPct, fmtPx, deltaClass } from '../lib/format.js';
import TickerLogo from './TickerLogo.jsx';
import Ico from './Ico.jsx';
import { FileText } from 'lucide-react';

// The trade date as the reader's locale prints it, without the year when
// it is this year: "31 Tem" / "Jul 31".
export const shortDay = (iso, lang) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  const thisYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', ...(thisYear ? {} : { year: 'numeric' }), timeZone: 'UTC' });
};

export const secForm4Url = (ci, acc) => `https://www.sec.gov/Archives/edgar/data/${Number(ci)}/${String(acc).replace(/-/g, '')}/`;

// The fund's own Form 4 lines (api/guru-form4): dated, priced trades inside
// the quarter, which the 13F table cannot show. Rendered on the manager
// page above the positions when there are any; nothing when there are none.
export default function GuruForm4({ data, limit = 8 }) {
  const { t, lang } = useI18n();
  const rows = data?.rows || [];
  if (!rows.length) return null;
  const shown = rows.slice(0, limit);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}><Ico icon={FileText} /> {t('gf4.title')}</h3>
        <span className="muted small">{t('gf4.sub').replace('{n}', String(data.count))}{rows[0]?.f ? ` · ${t('gf4.lastDay')}: ${shortDay(rows[0].f, lang)}` : ''}</span>
      </div>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="data">
          <thead>
            <tr>
              <th className="l">{t('table.symbol')}</th>
              <th className="l">{t('gf4.date')}</th>
              <th className="l">{t('gf4.type')}</th>
              <th>{t('pair.shares')}</th>
              <th>{t('gf4.price')}</th>
              <th>{t('table.value')}</th>
              <th>{t('gf4.ownedAfter')}</th>
              <th className="l">SEC</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const buy = r.k === 'P' || (r.kind === 'buy');
              const sell = r.k === 'S';
              return (
                <tr key={`${r.a}:${r.d}:${r.s}`}>
                  <td className="l">
                    {r.t ? (
                      <Link to={`/stock/${r.t}`} style={{ fontWeight: 700 }}><TickerLogo ticker={r.t} size={18} /> {r.t}</Link>
                    ) : (
                      <span className="muted small">CIK {Number(r.ci)}</span>
                    )}
                    {r.company && <span className="muted small" style={{ marginLeft: 6 }}>{r.company}</span>}
                  </td>
                  <td className="l" title={`${t('gf4.filed')}: ${r.f}`}>{shortDay(r.d, lang)}</td>
                  <td className="l">
                    <span className={`tk ${buy ? 'add' : sell ? 'reduce' : ''}`}>{t(`ins.code.${r.k}`) !== `ins.code.${r.k}` ? t(`ins.code.${r.k}`) : r.k}</span>
                    {r.planned && <span className="badge plain sm" style={{ marginLeft: 6 }} title={t('gf4.plannedTip')}>10b5-1</span>}
                    {r.amended && <span className="badge plain sm" style={{ marginLeft: 6 }}>4/A</span>}
                    {r.lines > 1 && <span className="muted small" style={{ marginLeft: 6 }} title={t('gf4.linesTip')}>×{r.lines}</span>}
                  </td>
                  <td className="num">{fmtNum(r.s)}</td>
                  <td className="num">{r.p != null ? fmtPx(r.p) : '—'}</td>
                  <td className="num">{r.v != null ? fmtMoney(r.v) : '—'}</td>
                  <td className={`num ${deltaClass(r.oc)}`} title={r.o != null ? `${fmtNum(r.o)} ${t('pair.shares').toLowerCase()}` : undefined}>{r.oc != null ? fmtPct(r.oc) : '—'}</td>
                  <td className="l"><a href={secForm4Url(r.ci, r.a)} target="_blank" rel="noopener noreferrer" className="muted small">Form 4 ↗</a></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && <p className="muted small mt8">{t('gf4.more').replace('{n}', String(rows.length - shown.length))}</p>}
      <p className="muted small mt8">{t('gf4.note')}</p>
    </div>
  );
}
