import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { fmtNum, fmtPct } from '../lib/format.js';

// Congress trades are disclosed as ranges ("$15,001 – $50,000"), never as
// an exact amount: show the range as filed.
// The brackets the forms use ($1,001 – $15,000, Over $50,000,000), in the
// round numbers people read them as: $1K – $15K, > $50M.
const short = (n) => {
  const v = n % 1000 === 1 ? n - 1 : n;
  const trim = (x) => String(Number(x.toFixed(1)));
  if (v >= 1e6) return `$${trim(v / 1e6)}M`;
  if (v >= 1e3) return `$${trim(v / 1e3)}K`;
  return `$${v}`;
};
export function fmtRange(lo, hi) {
  if (lo == null) return '—';
  if (hi == null) return `> ${short(lo - 1)}`;
  return `${short(lo)} – ${short(hi)}`;
}

export const partyClass = (p) => (p === 'D' ? 'party-d' : p === 'R' ? 'party-r' : 'party-i');

export function MemberTag({ r }) {
  const { t } = useI18n();
  return (
    <span className="muted small">
      {r.p ? <b className={partyClass(r.p)}>{r.p}</b> : '—'} · {r.ch === 'S' ? t('cg.senate') : t('cg.house')}
      {r.st ? ` · ${r.st}` : ''}
    </span>
  );
}

export function KindBadge({ k }) {
  const { t } = useI18n();
  const cls = k === 'buy' ? 'pos' : k === 'sell' || k === 'sell_partial' ? 'neg' : 'plain';
  return <span className={`badge ${cls}`}>{t(`cg.kind.${k || 'other'}`)}</span>;
}

// One table for every list of trades: the overview, a member, a stock.
export default function CongressTable({ rows, showMember = true, showTicker = true }) {
  const { t } = useI18n();
  if (!rows?.length) return <p className="muted">{t('cg.none')}</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {showMember && <th className="l">{t('cg.member')}</th>}
            {showTicker && <th className="l">{t('cg.asset')}</th>}
            <th>{t('cg.type')}</th>
            <th>{t('cg.amount')}</th>
            <th>{t('cg.traded')}</th>
            <th>{t('cg.filed')}</th>
            <th title={t('cg.retTip')}>{t('cg.ret')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {showMember && (
                <td className="l">
                  <Link to={`/congress/${r.slug}`} style={{ fontWeight: 700 }}>{r.n}</Link>
                  <div><MemberTag r={r} /></div>
                </td>
              )}
              {showTicker && (
                <td className="l">
                  {r.t ? <Link to={`/stock/${r.t}`} style={{ fontWeight: 700 }}>{r.t}</Link> : null}
                  <div className="muted small" style={{ maxWidth: 320 }}>{r.a}</div>
                </td>
              )}
              <td>
                <KindBadge k={r.k} />
                {r.o && r.o !== 'self' && <div className="muted small">{t(`cg.owner.${r.o}`)}</div>}
              </td>
              <td className="num">{fmtRange(r.lo, r.hi)}</td>
              <td className="num muted">{r.d}</td>
              <td className="num muted">
                <a href={r.src} target="_blank" rel="noopener noreferrer nofollow" title={t('cg.source')}>{r.f}</a>
              </td>
              <td className="num">
                {r.ret != null ? (
                  <span className={r.ret >= 0 ? 'delta-pos' : 'delta-neg'} title={r.pt != null ? `${fmtNum(r.pt, 2)} → ${fmtNum(r.cur, 2)}` : undefined}>{fmtPct(r.ret * 100)}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Not the 13F caveat: what a reader of these disclosures should know.
export function CongressDisclaimer() {
  const { t } = useI18n();
  return <p className="muted small mt8">{t('cg.disclaimer')}</p>;
}
