import { useMemo, useState } from 'react';
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

// The trade is in the field of a committee the member sits on: the
// company's SEC industry code falls inside that committee's jurisdiction
// (api/_lib/congressJurisdiction.js). A mechanical match, not a finding.
// an industry label from congressJurisdiction.js, in the page's language
export const indLabel = (t, label) => t(`cg.ind.${label}`).replace(/^cg\.ind\./, '');

export function FieldBadge({ field }) {
  const { t } = useI18n();
  if (!field?.length) return null;
  const tip = field.map((c) => `${c.name} — ${indLabel(t, c.label)}`).join('\n');
  return (
    <span className="badge warn sm cg-field" title={`${t('cg.fieldTip')}\n${tip}`} data-field={field.map((c) => c.id).join(',')}>
      ⚑ {t('cg.fieldBadge')}
    </span>
  );
}

export function KindBadge({ k }) {
  const { t } = useI18n();
  const cls = k === 'buy' ? 'pos' : k === 'sell' || k === 'sell_partial' ? 'neg' : 'plain';
  return <span className={`badge ${cls}`}>{t(`cg.kind.${k || 'other'}`)}</span>;
}

// One table for every list of trades: the overview, a member, a stock.
// a line with no ticker: what kind of asset it is, so a missing link reads as expected
const ASSET_LABELS = new Set(['bond', 'crypto', 'option', 'stock', 'other']);

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
                  {!r.t && !r.tf && <span className="badge sm" title={t('cg.noTickerTip')} data-asset={r.at || 'other'}>{t(`cg.asset.${ASSET_LABELS.has(r.at) ? r.at : 'other'}`)}</span>}
                  {r.tf && <span className="badge warn sm" title={t('cg.tickerMismatchTip').replace('{tf}', r.tf).replace('{tn}', r.tn || '')} data-flag="ticker-mismatch">{r.tf} · {t('cg.tickerMismatch')}</span>}
                  <div className="muted small" style={{ maxWidth: 320 }}>{r.a}</div>
                  {r.field && <div style={{ whiteSpace: 'normal' }}><FieldBadge field={r.field} /> <span className="muted small">{[...new Set(r.field.map((c) => indLabel(t, c.label)))].join(', ')}</span></div>}
                </td>
              )}
              <td>
                <KindBadge k={r.k} />
                {r.o && r.o !== 'self' && <div className="muted small">{t(`cg.owner.${r.o}`)}</div>}
                {!showTicker && r.field && <div><FieldBadge field={r.field} /></div>}
              </td>
              <td className="num">{fmtRange(r.lo, r.hi)}</td>
              <td className="num muted">{r.d}</td>
              <td className="num muted">
                <a href={r.src} target="_blank" rel="noopener noreferrer nofollow" title={t('cg.source')}>{r.f}</a>
                {r.late && <div><span className="badge sm" title={t('cg.lateTip').replace('{n}', fmtNum(r.late))} data-flag="late">{t('cg.late')}</span></div>}
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

const pctCell = (v, digits = 1) => (v == null ? <span className="muted">—</span> : <span className={v >= 0 ? 'delta-pos' : 'delta-neg'}>{fmtPct(v * 100, { digits })}</span>);

// two figures in one tile: smaller, on one line
const SPLIT = { fontSize: '1.05rem', whiteSpace: 'nowrap' };

// Members of Congress against SPY, year to date (api/_lib/congressModel.js
// memberYtd): the summary tiles, then every member, filterable.
export function YtdBoard({ data }) {
  const { t } = useI18n();
  const [f, setF] = useState({ ch: '', p: '', min: String(data?.minPositions || 3), sort: 'ret' });
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const rows = useMemo(() => {
    if (!data?.members) return [];
    const min = Number(f.min) || 1;
    const key = f.sort === 'excess' ? 'excess' : 'ret';
    return data.members
      .filter((m) => m.positions >= min && (!f.ch || m.ch === f.ch) && (!f.p || m.p === f.p))
      .sort((a, b) => b[key] - a[key] || a.n.localeCompare(b.n));
  }, [data, f]);
  if (!data) return <p className="muted">{t('cg.ytd.none')}</p>;
  const s = data.summary || {};
  const beat = (g) => (g?.beat == null ? '—' : Math.round(g.beat * 100));
  return (
    <>
      <h3 style={{ marginTop: 0 }}>{t('cg.ytd.title').replace('{year}', data.year)}</h3>
      <div className="fund-stats">
        <div className="fund-stat">
          <span className="k">{t('cg.ytd.spy')}</span>
          <b>{pctCell(data.spy)}</b>
          <span className="s">{t('cg.ytd.spyNote').replace('{from}', data.from).replace('{asOf}', data.asOf)}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.ytd.median')}</span>
          <b>{pctCell(s.all?.median)}</b>
          <span className="s">{t('cg.ytd.medianNote').replace('{n}', fmtNum(s.all?.n)).replace('{beat}', beat(s.all))}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.ytd.party')}</span>
          <b style={SPLIT}><span className="party-d">D</span> {pctCell(s.D?.median)} · <span className="party-r">R</span> {pctCell(s.R?.median)}</b>
          <span className="s">D {fmtNum(s.D?.n)} · R {fmtNum(s.R?.n)}</span>
        </div>
        <div className="fund-stat">
          <span className="k">{t('cg.ytd.chamber')}</span>
          <b style={SPLIT}>H {pctCell(s.H?.median)} · S {pctCell(s.S?.median)}</b>
          <span className="s">{t('cg.house')} {fmtNum(s.H?.n)} · {t('cg.senate')} {fmtNum(s.S?.n)}</span>
        </div>
      </div>

      <div className="cg-filters mt16">
        <select className="select" value={f.ch} onChange={(e) => set('ch', e.target.value)} aria-label={t('cg.chamber')}>
          <option value="">{t('cg.allChambers')}</option>
          <option value="H">{t('cg.house')}</option>
          <option value="S">{t('cg.senate')}</option>
        </select>
        <select className="select" value={f.p} onChange={(e) => set('p', e.target.value)} aria-label={t('cg.party')}>
          <option value="">{t('cg.allParties')}</option>
          <option value="D">{t('cg.party.D')}</option>
          <option value="R">{t('cg.party.R')}</option>
          <option value="I">{t('cg.party.I')}</option>
        </select>
        <select className="select" value={f.min} onChange={(e) => set('min', e.target.value)} aria-label={t('cg.ytd.positions')}>
          {['1', '3', '5', '10'].map((n) => <option key={n} value={n}>{t('cg.ytd.min').replace('{n}', n)}</option>)}
        </select>
        <select className="select" value={f.sort} onChange={(e) => set('sort', e.target.value)} aria-label={t('cg.ytd.sortRet')}>
          <option value="ret">{t('cg.ytd.sortRet')}</option>
          <option value="excess">{t('cg.ytd.sortExcess')}</option>
        </select>
        <span className="muted small">{t('cg.found').replace('{n}', fmtNum(rows.length))}</span>
      </div>

      {rows.length ? (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th className="l">#</th>
                <th className="l">{t('cg.member')}</th>
                <th title={t('cg.ytd.retTip')}>{t('cg.ytd.ret')}</th>
                <th title={t('cg.ytd.vsSpyTip')}>{t('cg.ytd.vsSpy')}</th>
                <th title={t('cg.ytd.excessTip')}>{t('cg.ytd.excess')}</th>
                <th title={t('cg.ytd.positionsTip')}>{t('cg.ytd.positions')}</th>
                <th className="l">{t('cg.ytd.best')}</th>
                <th className="l">{t('cg.ytd.worst')}</th>
                <th title={t('cg.volumeTip')}>{t('cg.ytd.weight')}</th>
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
                  <td className="num"><b>{pctCell(m.ret)}</b></td>
                  <td className="num muted">{fmtPct(m.spy * 100)}</td>
                  <td className="num">{m.excess == null ? '—' : <span className={m.excess >= 0 ? 'delta-pos' : 'delta-neg'}>{`${m.excess >= 0 ? '+' : ''}${(m.excess * 100).toFixed(1)} pp`}</span>}</td>
                  <td className="num">{fmtNum(m.open)} / {fmtNum(m.positions)}</td>
                  <td className="l">{m.best ? <><Link to={`/stock/${m.best.t}`}>{m.best.t}</Link> <span className="small">{pctCell(m.best.r, 0)}</span></> : '—'}</td>
                  <td className="l">{m.worst ? <><Link to={`/stock/${m.worst.t}`}>{m.worst.t}</Link> <span className="small">{pctCell(m.worst.r, 0)}</span></> : '—'}</td>
                  <td className="num">~{fmtMoney(m.weight)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">{t('cg.none')}</p>
      )}
      <p className="muted small mt8">{t('cg.ytd.note').replace('{min}', data.minPositions)}</p>
    </>
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
              <th title={t('cg.fieldTip')}>{t('cg.inFieldCol')}</th>
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
                <td className="num">{c.inField ? <b>{fmtNum(c.inField)}</b> : <span className="muted">—</span>}</td>
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
