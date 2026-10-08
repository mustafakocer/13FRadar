import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.jsx';
import { fmtMoney, fmtNum, fmtPct } from '../lib/format.js';
import TickerLogo from './TickerLogo.jsx';

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

export function TickerBoard({ rows }) {
  const { t } = useI18n();
  if (!rows?.length) return <p className="muted">{t('cg.none')}</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th className="l">#</th>
            <th className="l">{t('cg.asset')}</th>
            <th>{t('cg.members')}</th>
            <th>{t('cg.trades')}</th>
            <th title={t('cg.volumeTip')}>{t('cg.volume')}</th>
            <th>{t('cg.price')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.t}>
              <td className="l muted">{i + 1}</td>
              <td className="l">
                <Link to={`/stock/${r.t}`} className="tk-cell"><TickerLogo ticker={r.t} size={24} /> <b>{r.t}</b></Link>
                <div className="muted small" style={{ maxWidth: 320 }}>{r.a}</div>
              </td>
              <td className="num">{fmtNum(r.members)}</td>
              <td className="num">{fmtNum(r.trades)}</td>
              <td className="num">~{fmtMoney(r.volume)}</td>
              <td className="num muted">{r.cur != null ? fmtNum(r.cur, 2) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MemberBoard({ rows }) {
  const { t } = useI18n();
  if (!rows?.length) return <p className="muted">{t('cg.none')}</p>;
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th className="l">#</th>
            <th className="l">{t('cg.member')}</th>
            <th>{t('cg.trades')}</th>
            <th>{t('cg.buys')}</th>
            <th>{t('cg.sells')}</th>
            <th title={t('cg.volumeTip')}>{t('cg.volume')}</th>
            <th title={t('cg.avgRetTip')}>{t('cg.avgRet')}</th>
            <th>{t('cg.lastFiled')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m, i) => (
            <tr key={m.key}>
              <td className="l muted">{i + 1}</td>
              <td className="l">
                <Link to={`/congress/${m.slug}`} style={{ fontWeight: 700 }}>{m.n}</Link>
                <div><MemberTag r={m} /></div>
              </td>
              <td className="num">{fmtNum(m.trades)}</td>
              <td className="num">{fmtNum(m.buys)}</td>
              <td className="num">{fmtNum(m.sells)}</td>
              <td className="num">~{fmtMoney(m.volume)}</td>
              <td className="num">{m.avgBuyRet != null ? <span className={m.avgBuyRet >= 0 ? 'delta-pos' : 'delta-neg'}>{fmtPct(m.avgBuyRet * 100)}</span> : '—'}</td>
              <td className="num muted">{m.last || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


const CHAMBER = { H: 'cg.house', S: 'cg.senate', J: 'cg.joint' };

// Committees with members on file, busiest first.
export function CommitteeBoard({ rows }) {
  const { t } = useI18n();
  if (!rows?.length) return <p className="muted">{t('cg.none')}</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="l">#</th>
              <th className="l">{t('cg.committee')}</th>
              <th>{t('cg.members')}</th>
              <th>{t('cg.trades')}</th>
              <th>{t('cg.buys')}</th>
              <th>{t('cg.sells')}</th>
              <th title={t('cg.volumeTip')}>{t('cg.volume')}</th>
              <th>{t('cg.lastFiled')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={c.id}>
                <td className="l muted">{i + 1}</td>
                <td className="l" style={{ whiteSpace: 'normal', minWidth: 220 }}>
                  <Link to={`/congress/committee/${c.slug}`} style={{ fontWeight: 700 }}>{c.name}</Link>
                  <div className="muted small">{t(CHAMBER[c.ch])}</div>
                </td>
                <td className="num">{fmtNum(c.members)}</td>
                <td className="num">{fmtNum(c.trades)}</td>
                <td className="num">{fmtNum(c.buys)}</td>
                <td className="num">{fmtNum(c.sells)}</td>
                <td className="num">~{fmtMoney(c.volume)}</td>
                <td className="num muted">{c.last || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small mt8">{t('cg.committeesNote')}</p>
    </>
  );
}
